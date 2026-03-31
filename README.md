# @theyahia/tilda-mcp

MCP-сервер для Tilda API — проекты, страницы, полный экспорт. **3 инструмента.**

[![npm](https://img.shields.io/npm/v/@theyahia/tilda-mcp)](https://www.npmjs.com/package/@theyahia/tilda-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Часть серии [Russian API MCP](https://github.com/theYahia/russian-mcp) (50 серверов) by [@theYahia](https://github.com/theYahia).

## Установка

### Claude Desktop

```json
{
  "mcpServers": {
    "tilda": {
      "command": "npx",
      "args": ["-y", "@theyahia/tilda-mcp"],
      "env": { "TILDA_PUBLIC_KEY": "your-public-key", "TILDA_SECRET_KEY": "your-secret-key" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add tilda -e TILDA_PUBLIC_KEY=your-public-key -e TILDA_SECRET_KEY=your-secret-key -- npx -y @theyahia/tilda-mcp
```

### VS Code / Cursor

```json
{ "servers": { "tilda": { "command": "npx", "args": ["-y", "@theyahia/tilda-mcp"], "env": { "TILDA_PUBLIC_KEY": "your-public-key", "TILDA_SECRET_KEY": "your-secret-key" } } } }
```

> Требуется `TILDA_PUBLIC_KEY` и `TILDA_SECRET_KEY`. Получите в [настройках аккаунта Tilda](https://tilda.cc/identity/apikeys/).

## Инструменты (3)

| Инструмент | Описание |
|------------|----------|
| `get_projects` | Список проектов |
| `get_pages` | Список страниц проекта |
| `get_page` | Полная информация о странице (HTML, CSS, JS) |

## Примеры

```
Покажи мои проекты в Tilda
Список страниц проекта 12345
Покажи содержимое страницы 67890
```

## Лицензия

MIT
