
from datetime import timezone, timedelta


# Counter capacity for each service
COUNTER_CAPACITY = {
    "General": 3,
    "Account Services": 4,
    "Customer Support": 5,
}


# Counter naming prefixes
COUNTER_PREFIX = {
    "General": "GEN",
    "Account Services": "ACC",
    "Customer Support": "SUP",
}


# Default service time in minutes
DEFAULT_SERVICE_MINUTES = {
    "General": 6,
    "Account Services": 8,
    "Customer Support": 5,
}


# Timezone used for analytics reports (IST)
REPORT_TIMEZONE = timezone(timedelta(hours=5, minutes=30))


# Demo staff details
DEMO_STAFF = [
    ("Demo Staff", "staff@queuepulse.demo"),
    ("Demo Accounts Staff 1", "accounts1@queuepulse.demo"),
    ("Demo Accounts Staff 2", "accounts2@queuepulse.demo"),
    ("Demo Support Staff", "support@queuepulse.demo"),
]


# Demo staff password
DEMO_PASSWORD = "QueuePulse123"
