@echo off
cd /d "%~dp0"
python -m pip install -r requirements.txt
if not exist .env python setup.py
python -m uvicorn server.main:app --host 127.0.0.1 --port 8000
pause
