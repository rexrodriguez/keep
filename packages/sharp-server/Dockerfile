FROM pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime

WORKDIR /app

# Install system deps needed for git-based pip install
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

# Install Python deps
RUN pip install --no-cache-dir \
    fastapi==0.115.0 \
    "uvicorn[standard]==0.31.0" \
    pillow==11.3.0 \
    numpy \
    scipy==1.16.2 \
    "ml-sharp @ git+https://github.com/apple/ml-sharp.git"

# Copy server source
COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
