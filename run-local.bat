@echo off
REM run-local.bat — Inicia o backend FastAPI local
echo Iniciando backend na porta 8001...
echo Swagger: http://localhost:8001/api/docs
echo.
call venv\Scripts\uvicorn app.main:app --reload --port 8001
