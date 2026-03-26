"""
SAP MCP Tools — integração opcional com servidores MCP da SAP.

Ativado com MCP_ENABLED=true no .env. Requer Node.js instalado.

Servidores suportados:
  - @cap-js/mcp-server     (SAP CAP — schema, services, metadata)
  - @ui5/mcp-server        (UI5 — component APIs, controls)
  - @sap-ux/fiori-mcp-server (Fiori UX tools)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from langchain_core.tools import BaseTool

_mcp_client = None
_mcp_tools: list["BaseTool"] = []


async def init_mcp_tools() -> None:
    """Inicializa o cliente MCP e carrega as ferramentas disponíveis."""
    global _mcp_client, _mcp_tools

    try:
        from langchain_mcp_adapters.client import MultiServerMCPClient
    except ImportError:
        return

    _mcp_client = MultiServerMCPClient(
        {
            "cds-mcp": {
                "command": "npx",
                "args": ["-y", "@cap-js/mcp-server"],
                "transport": "stdio",
            },
            "ui5-mcp": {
                "command": "npx",
                "args": ["-y", "@ui5/mcp-server"],
                "transport": "stdio",
            },
            "fiori-mcp": {
                "command": "npx",
                "args": ["--yes", "@sap-ux/fiori-mcp-server@latest", "fiori-mcp"],
                "transport": "stdio",
            },
        }
    )

    try:
        _mcp_tools = await _mcp_client.get_tools()
    except Exception:
        _mcp_tools = []


async def close_mcp_tools() -> None:
    global _mcp_client, _mcp_tools
    _mcp_client = None
    _mcp_tools = []


def get_mcp_tools() -> list["BaseTool"]:
    return _mcp_tools
