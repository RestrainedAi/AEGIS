FROM python:3.12-slim

WORKDIR /app

# No external pip packages needed — uses only stdlib + sibling scripts
COPY youtube_uploader.py queue_manager.py ./

# Entrypoint: queue_manager.py run
# Cloud Run Job passes args via --args in job spec
ENTRYPOINT ["python", "queue_manager.py"]
CMD ["run", "--limit", "20"]
