
import math
from datetime import datetime

from fastapi import APIRouter, Depends, Query

from database import connect_db

from config import (
    DEFAULT_SERVICE_MINUTES,
    REPORT_TIMEZONE,
)

from ml_config import MODEL_PATH
from ml_model import train_model, predict_wait_time

from utils.helpers import (
    require_staff,
    check_service,
    capacity_for,
    estimate_service_minutes,
    parse_database_timestamp,
    hour_label,
)


router = APIRouter()


# Identify queue bottlenecks and suggest additional counters
@router.get("/analytics/bottlenecks")
def get_bottlenecks(
    service: str = Query(...),
    user=Depends(require_staff)
):
    check_service(service)

    with connect_db() as connection:

        waiting = connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM tokens
            WHERE service = ? AND status = 'waiting'
            """,
            (service,),
        ).fetchone()["count"]

        in_service = connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM tokens
            WHERE service = ? AND status = 'called'
            """,
            (service,),
        ).fetchone()["count"]

        average_minutes = estimate_service_minutes(
            connection, service
        )

        capacity = max(1, capacity_for(service))

        workload = waiting + in_service

        current_wait = math.ceil(
            workload / capacity
        ) * average_minutes

        projected_wait = math.ceil(
            workload / (capacity + 1)
        ) * average_minutes

        improvement = max(
            0,
            current_wait - projected_wait
        )

    is_bottleneck = (
        waiting >= capacity * 2
        or (waiting > 0 and in_service >= capacity)
        or current_wait >= 15
    )

    return [
        {
            "service": service,
            "waiting": waiting,
            "in_service": in_service,
            "counter_capacity": capacity,
            "average_service_minutes": average_minutes,
            "estimated_queue_minutes": current_wait,
            "bottleneck": is_bottleneck,
            "recommendation": (
                f"Consider opening one extra counter for {service}"
                if is_bottleneck
                else "Current counter capacity looks sufficient"
            ),
            "projected_wait_with_extra_counter_minutes": projected_wait,
            "projected_improvement_minutes": improvement,
        }
    ]


# Get complete service analytics summary with ML prediction
@router.get("/analytics/summary")
def get_analytics_summary(
    service: str = Query(...),
    user=Depends(require_staff)
):
    check_service(service)

    with connect_db() as connection:

        # Current queue statistics
        current = connection.execute(
            """
            SELECT
                SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting,
                SUM(CASE WHEN status = 'called' THEN 1 ELSE 0 END) AS in_service,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
            FROM tokens
            WHERE service = ?
            """,
            (service,),
        ).fetchone()

        # Average waiting and service time
        timing = connection.execute(
            """
            SELECT
                AVG(
                    (julianday(completed_at) - julianday(called_at)) * 1440.0
                ) AS avg_service_minutes,
                AVG(
                    (julianday(called_at) - julianday(created_at)) * 1440.0
                ) AS avg_wait_minutes
            FROM tokens
            WHERE service = ?
              AND status = 'completed'
              AND called_at IS NOT NULL
              AND completed_at IS NOT NULL
            """,
            (service,),
        ).fetchone()

        # Token creation timestamps
        timestamps = connection.execute(
            """
            SELECT created_at
            FROM tokens
            WHERE service = ?
            """,
            (service,),
        ).fetchall()

    # Hourly customer visits
    hourly_counts = [0] * 24

    for row in timestamps:
        recorded = parse_database_timestamp(row["created_at"])

        if recorded:
            local_time = recorded.astimezone(REPORT_TIMEZONE)
            hourly_counts[local_time.hour] += 1

    total_visits = sum(hourly_counts)

    peak_hour = None
    peak_hour_visits = 0

    if total_visits:
        peak_index = max(
            range(24),
            key=lambda hour: hourly_counts[hour]
        )

        peak_hour_visits = hourly_counts[peak_index]
        peak_hour = hour_label(peak_index)

    average_service = (
        round(timing["avg_service_minutes"], 1)
        if timing["avg_service_minutes"] is not None
        else None
    )

    average_wait = (
        round(timing["avg_wait_minutes"], 1)
        if timing["avg_wait_minutes"] is not None
        else None
    )

    waiting = current["waiting"] or 0
    in_service = current["in_service"] or 0
    completed = current["completed"] or 0

    capacity = max(1, capacity_for(service))

    estimate_minutes = (
        average_service
        or DEFAULT_SERVICE_MINUTES.get(service, 6)
    )

    # Existing formula-based fallback
    formula_estimate = math.ceil(
        (waiting + in_service) / capacity
    ) * estimate_minutes

    # Train using real completed records when sufficient data exists.
    # Until then, the existing formula remains active.
    try:
        training_status = train_model()
    except Exception as error:
        training_status = {
            "trained": False,
            "message": f"ML training unavailable: {str(error)}",
        }

    # Predict using current queue conditions
    now = datetime.now(REPORT_TIMEZONE)

    ml_result = predict_wait_time(
        service=service,
        hour=now.hour,
        weekday=now.weekday(),
        waiting_count=waiting,
        in_service_count=in_service,
        working_counters=capacity,
        average_service_minutes=estimate_minutes,
    )

    if ml_result.get("prediction_available"):
        estimated_wait = ml_result["predicted_wait_minutes"]
        prediction_source = "random_forest"
    else:
        estimated_wait = round(formula_estimate)
        prediction_source = "formula"

    # Recommendations
    recommendations = []

    if total_visits < 10:
        recommendations.append(
            "Peak-hour insight is preliminary. Collect more visits "
            "for a reliable demand pattern."
        )
    elif peak_hour:
        recommendations.append(
            f"Your busiest arrival period is {peak_hour} "
            f"({peak_hour_visits} recorded visits). "
            "Consider scheduling more staff around this period."
        )

    if average_wait is not None and average_wait >= 10:
        recommendations.append(
            f"Average recorded wait is {average_wait} minutes. "
            "Review staffing during busy periods."
        )

    default_minutes = DEFAULT_SERVICE_MINUTES.get(service, 6)

    if (
        average_service is not None
        and average_service > default_minutes * 1.3
    ):
        recommendations.append(
            f"Average service takes {average_service} minutes. "
            "Review the steps for this service."
        )

    if waiting >= capacity or (
        waiting > 0 and in_service >= capacity
    ):
        recommendations.append(
            "All counters are busy or the line is growing. "
            "Prioritize opening an available counter."
        )

    if prediction_source == "random_forest":
        recommendations.append(
            "Waiting-time estimate is generated by the "
            "Random Forest ML model."
        )
    else:
        recommendations.append(
            "Formula-based waiting-time estimation is active "
            "until sufficient real training data is available."
        )

    if not recommendations:
        recommendations.append(
            "Current service performance looks steady. "
            "Keep monitoring as more visits are recorded."
        )

    return {
        "service": service,
        "timezone": "Asia/Kolkata",
        "sample_visits": total_visits,
        "waiting": waiting,
        "in_service": in_service,
        "completed": completed,
        "counter_capacity": capacity,

        # Existing dashboard field, now uses ML when available
        "estimated_current_queue_minutes": round(estimated_wait),

        # Additional ML information
        "formula_estimated_queue_minutes": round(formula_estimate),
        "predicted_wait_minutes": (
            ml_result.get("predicted_wait_minutes")
            if prediction_source == "random_forest"
            else None
        ),
        "prediction_source": prediction_source,
        "ml_prediction_available": (
            prediction_source == "random_forest"
        ),
        "ml_training_status": training_status,

        "average_wait_minutes": average_wait,
        "average_service_minutes": average_service,
        "peak_hour": peak_hour,
        "peak_hour_visits": peak_hour_visits,

        "hourly_volume": [
            {
                "hour": hour_label(hour),
                "count": hourly_counts[hour],
            }
            for hour in range(24)
        ],

        "recommendations": recommendations,
    }
