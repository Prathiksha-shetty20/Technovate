
import math

from fastapi import APIRouter, Depends, Query

from database import connect_db

from config import (
    DEFAULT_SERVICE_MINUTES,
    REPORT_TIMEZONE,
)

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

        capacity = capacity_for(service)

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


# Get complete service analytics summary
@router.get("/analytics/summary")
def get_analytics_summary(
    service: str = Query(...),
    user=Depends(require_staff)
):

    check_service(service)

    with connect_db() as connection:

        # Get current queue statistics
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

        # Calculate average waiting and service time
        timing = connection.execute(
            """
            SELECT
                AVG((julianday(completed_at) - julianday(called_at)) * 1440.0) AS avg_service_minutes,
                AVG((julianday(called_at) - julianday(created_at)) * 1440.0) AS avg_wait_minutes
            FROM tokens
            WHERE service = ?
              AND status = 'completed'
              AND called_at IS NOT NULL
              AND completed_at IS NOT NULL
            """,
            (service,),
        ).fetchone()

        # Get token creation timestamps
        timestamps = connection.execute(
            """
            SELECT created_at
            FROM tokens
            WHERE service = ?
            """,
            (service,),
        ).fetchall()

    # Calculate hourly customer visits
    hourly_counts = [0] * 24

    for row in timestamps:

        recorded = parse_database_timestamp(
            row["created_at"]
        )

        if recorded:

            local_time = recorded.astimezone(
                REPORT_TIMEZONE
            )

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

    # Calculate average service time
    average_service = (
        round(timing["avg_service_minutes"], 1)
        if timing["avg_service_minutes"] is not None
        else None
    )

    # Calculate average waiting time
    average_wait = (
        round(timing["avg_wait_minutes"], 1)
        if timing["avg_wait_minutes"] is not None
        else None
    )

    # Current queue statistics
    waiting = current["waiting"] or 0
    in_service = current["in_service"] or 0
    completed = current["completed"] or 0

    capacity = capacity_for(service)

    estimate_minutes = (
        average_service
        or DEFAULT_SERVICE_MINUTES.get(service, 6)
    )

    current_queue_estimate = math.ceil(
        (waiting + in_service) / capacity
    ) * estimate_minutes

    # Generate service recommendations
    recommendations = []

    if total_visits < 10:

        recommendations.append(
            "Peak-hour insight is preliminary. Collect more visits for a reliable demand pattern."
        )

    elif peak_hour:

        recommendations.append(
            f"Your busiest arrival period is {peak_hour} ({peak_hour_visits} recorded visits). "
            "Consider scheduling more staff around this period."
        )

    if average_wait is not None and average_wait >= 10:

        recommendations.append(
            f"Average recorded wait is {average_wait} minutes. Review staffing during busy periods."
        )

    default_minutes = DEFAULT_SERVICE_MINUTES.get(service, 6)

    if (
        average_service is not None
        and average_service > default_minutes * 1.3
    ):

        recommendations.append(
            f"Average service takes {average_service} minutes. Review the steps for this service."
        )

    if waiting >= capacity or (
        waiting > 0 and in_service >= capacity
    ):

        recommendations.append(
            "All counters are busy or the line is growing. Prioritize opening an available counter."
        )

    if not recommendations:

        recommendations.append(
            "Current service performance looks steady. Keep monitoring as more visits are recorded."
        )

    return {
        "service": service,
        "timezone": "Asia/Kolkata",
        "sample_visits": total_visits,
        "waiting": waiting,
        "in_service": in_service,
        "completed": completed,
        "counter_capacity": capacity,
        "estimated_current_queue_minutes": round(current_queue_estimate),
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
