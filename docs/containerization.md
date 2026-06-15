# Containerization

## Local Docker commands

Compose requires `APP_UID` and `APP_GID` for every command that reads `docker-compose.yml`. They are not baked into either the backend or frontend image.

Linux/macOS/WSL:
Export them once for commands such as `docker compose ps`, or prefix each Compose command with the same values.

```sh
export APP_UID=$(id -u) APP_GID=$(id -g)
```


```sh
APP_UID=$(id -u) APP_GID=$(id -g) docker compose build
APP_UID=$(id -u) APP_GID=$(id -g) docker compose up -d
docker compose ps
```

Windows PowerShell:

```powershell
$env:APP_UID = "1000"
$env:APP_GID = "1000"
docker compose build
docker compose up -d
```
