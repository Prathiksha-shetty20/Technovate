
from pathlib import Path

# ML model configuration

BASE_DIR = Path(__file__).resolve().parent

MODEL_DIR = BASE_DIR / "models"
MODEL_PATH = MODEL_DIR / "wait_time_model.pkl"

# Minimum real completed transactions required for training
MIN_TRAINING_RECORDS = 30

# Retrain after every 10 new completed transactions
RETRAIN_INTERVAL = 10

# Model settings
RANDOM_STATE = 42
N_ESTIMATORS = 100

# Prediction settings
MIN_PREDICTED_WAIT = 0
MAX_PREDICTED_WAIT = 240
