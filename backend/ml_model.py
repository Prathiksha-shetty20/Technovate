import logging
import sqlite3
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

from config import COUNTER_CAPACITY, DEFAULT_SERVICE_MINUTES
from ml_config import (
    MODEL_DIR,
    MODEL_PATH,
    MIN_TRAINING_RECORDS,
    RETRAIN_INTERVAL,
    N_ESTIMATORS,
    RANDOM_STATE,
    MAX_PREDICTED_WAIT,
)

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "queuepulse.db"

FEATURES = [
    "service",
    "hour",
    "weekday",
    "waiting_count",
    "in_service_count",
    "working_counters",
    "average_service_minutes",
]

logger = logging.getLogger(__name__)


def get_training_data():
    """Prepare training records from real completed transactions."""

    with sqlite3.connect(DB_PATH) as connection:
        df = pd.read_sql_query(
            """
            SELECT service, created_at, called_at, completed_at
            FROM tokens
            WHERE LOWER(status) = 'completed'
              AND created_at IS NOT NULL
              AND called_at IS NOT NULL
              AND completed_at IS NOT NULL
            """,
            connection,
        )

        all_tokens = pd.read_sql_query(
            """
            SELECT service, created_at, called_at, completed_at
            FROM tokens
            WHERE created_at IS NOT NULL
            """,
            connection,
        )

    if df.empty:
        return df

    for column in ["created_at", "called_at", "completed_at"]:
        df[column] = pd.to_datetime(df[column], errors="coerce")
        all_tokens[column] = pd.to_datetime(
            all_tokens[column], errors="coerce"
        )

    df = df.dropna(
        subset=["service", "created_at", "called_at", "completed_at"]
    ).copy()

    all_tokens = all_tokens.dropna(
        subset=["service", "created_at"]
    ).copy()

    df["actual_wait_minutes"] = (
        df["called_at"] - df["created_at"]
    ).dt.total_seconds() / 60

    df["service_duration"] = (
        df["completed_at"] - df["called_at"]
    ).dt.total_seconds() / 60

    df = df[
        (df["actual_wait_minutes"] >= 0)
        & (df["actual_wait_minutes"] <= MAX_PREDICTED_WAIT)
        & (df["service_duration"] > 0)
    ].copy()

    if df.empty:
        return df

    df["hour"] = df["created_at"].dt.hour
    df["weekday"] = df["created_at"].dt.weekday

    waiting_counts = []
    in_service_counts = []

    for _, transaction in df.iterrows():
        service = transaction["service"]
        created = transaction["created_at"]

        earlier = all_tokens[
            (all_tokens["service"] == service)
            & (all_tokens["created_at"] < created)
        ]

        waiting = earlier[
            earlier["called_at"].isna()
            | (earlier["called_at"] > created)
        ]

        in_service = earlier[
            earlier["called_at"].notna()
            & (earlier["called_at"] <= created)
            & (
                earlier["completed_at"].isna()
                | (earlier["completed_at"] > created)
            )
        ]

        waiting_counts.append(len(waiting))
        in_service_counts.append(len(in_service))

    df["waiting_count"] = waiting_counts
    df["in_service_count"] = in_service_counts

    df["working_counters"] = (
        df["service"].map(COUNTER_CAPACITY).fillna(1)
    )

    df = df.sort_values("created_at").copy()
    averages = []

    for _, transaction in df.iterrows():
        previous = df[
            (df["service"] == transaction["service"])
            & (df["completed_at"] < transaction["created_at"])
        ]

        if previous.empty:
            average = DEFAULT_SERVICE_MINUTES.get(
                transaction["service"], 6
            )
        else:
            average = previous["service_duration"].mean()

        averages.append(average)

    df["average_service_minutes"] = averages

    return df.dropna(
        subset=FEATURES + ["actual_wait_minutes"]
    )


def train_model():
    """Train or update the Random Forest model using real records."""

    df = get_training_data()
    record_count = len(df)

    if MODEL_PATH.exists():
        try:
            saved = joblib.load(MODEL_PATH)
            previous_count = saved.get("records", 0)

            if record_count - previous_count < RETRAIN_INTERVAL:
                return {
                    "trained": True,
                    "records": record_count,
                    "message": "Existing Random Forest model is active.",
                    "test_mae_minutes": saved.get("test_mae_minutes"),
                }

        except Exception:
            logger.exception("Could not load existing ML model.")

    if record_count < MIN_TRAINING_RECORDS:
        return {
            "trained": False,
            "records": record_count,
            "message": (
                f"Need {MIN_TRAINING_RECORDS} valid real records. "
                f"Currently available: {record_count}."
            ),
        }

    X = pd.get_dummies(
        df[FEATURES].copy(),
        columns=["service"],
        dtype=int,
    )

    y = df["actual_wait_minutes"]

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=RANDOM_STATE,
    )

    test_model = RandomForestRegressor(
        n_estimators=N_ESTIMATORS,
        random_state=RANDOM_STATE,
        min_samples_leaf=2,
        n_jobs=-1,
    )

    test_model.fit(X_train, y_train)

    test_predictions = test_model.predict(X_test)
    test_mae = mean_absolute_error(y_test, test_predictions)

    final_model = RandomForestRegressor(
        n_estimators=N_ESTIMATORS,
        random_state=RANDOM_STATE,
        min_samples_leaf=2,
        n_jobs=-1,
    )

    final_model.fit(X, y)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    joblib.dump(
        {
            "model": final_model,
            "features": list(X.columns),
            "records": record_count,
            "test_mae_minutes": round(float(test_mae), 2),
        },
        MODEL_PATH,
    )

    return {
        "trained": True,
        "records": record_count,
        "test_mae_minutes": round(float(test_mae), 2),
        "message": "Random Forest trained using real completed transactions.",
    }


def predict_wait_time(
    service,
    hour,
    weekday,
    waiting_count,
    in_service_count,
    working_counters,
    average_service_minutes,
):
    """Predict customer waiting time using the saved Random Forest model."""

    if not MODEL_PATH.exists():
        return {
            "prediction_available": False,
            "source": "fallback",
            "message": "ML model has not been trained yet.",
        }

    try:
        saved = joblib.load(MODEL_PATH)

        row = pd.DataFrame(
            [{
                "service": service,
                "hour": hour,
                "weekday": weekday,
                "waiting_count": waiting_count,
                "in_service_count": in_service_count,
                "working_counters": working_counters,
                "average_service_minutes": average_service_minutes,
            }]
        )

        row = pd.get_dummies(
            row,
            columns=["service"],
            dtype=int,
        )

        row = row.reindex(
            columns=saved["features"],
            fill_value=0,
        )

        prediction = float(
            saved["model"].predict(row)[0]
        )

        prediction = max(
            0,
            min(MAX_PREDICTED_WAIT, prediction),
        )

        return {
            "prediction_available": True,
            "source": "random_forest",
            "predicted_wait_minutes": round(prediction, 1),
        }

    except Exception:
        logger.exception("Random Forest prediction failed.")

        return {
            "prediction_available": False,
            "source": "fallback",
            "message": "ML prediction failed.",
        }