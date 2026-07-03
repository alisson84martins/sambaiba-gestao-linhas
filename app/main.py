from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from app.core.config import settings
from app.routers import auth, turno, relatorios, linhas, escalas, coordenador

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="API do Sistema de Fiscalização de Linhas — Sambaíba G3",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers da API ────────────────────────────────────────────────────────────
app.include_router(auth.router,       prefix="/api/v1")
app.include_router(turno.router,      prefix="/api/v1")
app.include_router(relatorios.router, prefix="/api/v1")
app.include_router(linhas.router,     prefix="/api/v1")
app.include_router(escalas.router,    prefix="/api/v1")
app.include_router(coordenador.router, prefix="/api/v1")

# ── Endpoints de saúde ────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME, "version": settings.VERSION}

# ── Serve frontend estático (se pasta dist/ existir) ─────────────────────────
_dist = os.path.join(os.path.dirname(__file__), "..", "dist")
if os.path.isdir(_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_dist, "assets")), name="assets")

    # Página nova e independente do painel do coordenador — precisa de rota
    # explícita ANTES do catch-all da SPA abaixo, senão o catch-all devolveria
    # sempre o index.html do bundle React.
    @app.get("/painel-coordenador.html", include_in_schema=False)
    async def painel_coordenador_page():
        return FileResponse(os.path.join(_dist, "painel-coordenador.html"))

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        index = os.path.join(_dist, "index.html")
        return FileResponse(index)
