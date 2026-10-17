"""Seed fake posture data. From backend/: DATABASE_URL=... python scripts/seed.py [hours=6]"""
import os, sys, random
from datetime import datetime, timedelta, timezone
import psycopg2
from psycopg2.extras import execute_values

hours = int(sys.argv[1]) if len(sys.argv) > 1 else 6
users = [("user_1", "Demo User 1"), ("user_2", "Demo User 2")]
labels = ["good", "slouching", "leaning_forward", "head_tilt"]
conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()
execute_values(cur, "INSERT INTO users (user_id, display_name) VALUES %s ON CONFLICT DO NOTHING", users)
now = datetime.now(timezone.utc)
rows = []
for uid, _ in users:
    t = now - timedelta(hours=hours)
    state = "good"
    while t < now:
        if random.random() < 0.08:
            state = random.choices(labels, weights=[5, 3, 2, 1])[0]
        rows.append((t, uid, state, round(random.uniform(0.7, 0.99), 3)))
        t += timedelta(seconds=5)
execute_values(cur, "INSERT INTO posture_events (time, user_id, label, confidence) VALUES %s", rows, page_size=5000)
conn.commit()
print(f"Inserted {len(rows)} rows")

# Refresh the continuous aggregate so the dashboard shows seeded data immediately.
conn.autocommit = True
conn.cursor().execute("CALL refresh_continuous_aggregate('posture_per_minute', NULL, NULL)")
print("Refreshed posture_per_minute")
