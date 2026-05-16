# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install system dependencies (like Tesseract and OpenCV requirements)
# We copy packages.txt first to leverage Docker cache
COPY packages.txt /tmp/packages.txt
RUN apt-get update && \
    xargs -a /tmp/packages.txt apt-get install -y --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Set up a new user named "user" with user ID 1000
# (Hugging Face Spaces requires this for Docker spaces)
RUN useradd -m -u 1000 user

# Switch to the "user"
USER user

# Set home to the user's home directory
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# Set the working directory to the user's home directory
WORKDIR $HOME/app

# Copy requirements first to leverage Docker cache
COPY --chown=user requirements.txt $HOME/app/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY --chown=user . $HOME/app/

# Expose the port that Hugging Face expects
EXPOSE 7860

# Command to run the FastAPI app via Uvicorn
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
