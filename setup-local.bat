@echo off
REM setup-local.bat — Prepara o ambiente local para testar o backend
REM Execute no terminal dentro da pasta backend-fiscal\

echo ============================================
echo  Setup Local — Fiscalizacao de Linhas G3
echo ============================================

REM 1. Cria virtualenv
echo [1/4] Criando ambiente virtual...
python -m venv venv
if errorlevel 1 (
    echo ERRO: python nao encontrado. Instale Python 3.11+
    pause & exit /b 1
)

REM 2. Instala dependencias
echo [2/4] Instalando dependencias...
call venv\Scripts\pip install -r requirements.txt -q
if errorlevel 1 (
    echo ERRO ao instalar dependencias.
    pause & exit /b 1
)

REM 3. Cria .env se nao existir
if not exist .env (
    echo [3/4] Criando .env local...
    copy .env.local .env
    echo.
    echo  ATENCAO: Edite o arquivo .env com sua senha do PostgreSQL!
    echo  Pressione qualquer tecla apos editar...
    pause > nul
) else (
    echo [3/4] .env ja existe, pulando...
)

REM 4. Seed — cria o primeiro usuario ADMIN em public.usuario
echo [4/4] Criando usuario ADMIN inicial (public.usuario)...
set /p SEED_RE="  RE do admin (ex: ADMIN001): "
set /p SEED_NOME="  Nome completo: "
set /p SEED_SENHA="  Senha: "

call venv\Scripts\python seed.py --re %SEED_RE% --nome "%SEED_NOME%" --senha %SEED_SENHA%

echo.
echo ============================================
echo  Setup concluido!
echo  Para iniciar o backend:
echo    run-local.bat
echo ============================================
pause
