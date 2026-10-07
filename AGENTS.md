# Агентам по репозиторию moy-nalog

Неофициальная обёртка над API личного кабинета [lknpd.nalog.ru](https://lknpd.nalog.ru/) («Мой налог») для самозанятых. Пакет публикуется в npm как `moy-nalog` и ставится обычным Node.js. Сборка и тесты в репозитории идут через Bun. Им пользуются люди: не ломайте публичный API и не отправляйте запросы в налоговую из тестов.

## Структура

- `src/index.ts` — класс `NalogAPI`, единственная точка входа.
- `dist/` — сборка: `index.js` (ESM), `index.cjs` (CommonJS, `module.exports` — сам класс), `index.d.ts` и `index.d.cts`. Каталог не коммитится.
- `tests/index.test.ts` — тесты на `bun test`. HTTP только через подмену глобального `fetch`.
- `scripts/smoke-node.mjs` — `npm pack` и проверка `require` / `import` в обычном Node, без Bun.
- `docs/nalogAPIClass.md` — старый снимок JSDoc. Актуальный контракт — `src/index.ts` и сгенерированные типы.
- `.github/workflows/ci.yml` — lint, typecheck, test, build и smoke на Node 22 и 24.
- `.github/workflows/publish.yml` — публикация в npm только по тегу `v*`, через Trusted Publishing (OIDC). Секрет `NPM_TOKEN` не используется. Самим не публиковать и не создавать теги.

Базовый URL API: `https://lknpd.nalog.ru/api/v1`. Методы, которые библиотека вызывает сама: `POST /auth/lkfl`, `POST /auth/token`, `GET /user`, `POST /income`, `GET /receipt/{inn}/{uuid}/json`. Произвольный путь можно послать через `call(endpoint, payload, method)`.

Потребителям нужен Node.js 18 или новее: `fetch` глобальный, `cross-fetch` больше не поставляется.

## Зависимости, тесты, линт

В окружении агента Bun ставит `.cursor/install.sh`. Локально:

```bash
bun install
bun test
bun run lint
bun run typecheck
bun run build
node scripts/smoke-node.mjs
```

`bun test` не ходит в сеть. Секрет `USERPASS` и живой аккаунт налогоплательщика не нужны.

## Правила

- Не ломать публичный API: конструктор `{ login, password, autologin }`, методы `auth`, `getToken`, `call`, `addIncome`, `userInfo`, `dateToLocalISO`, поля `apiUrl`, `INN`, `token`, `tokenExpireIn`, `refreshToken`, `authPromise`, `sourceDeviceId`. `require('moy-nalog')` и `import NalogAPI from 'moy-nalog'` должны получать сам класс, не `{ default: ... }`.
- Версию в `package.json` не менять и в npm не публиковать, пока это явно не попросили. Сейчас опубликована линия 1.x; релиз 2.0.0 готовится тегом `v2.0.0`, который должен совпадать с `version`. Публикация в `.github/workflows/publish.yml` идёт через OIDC, без `NODE_AUTH_TOKEN`.
- Никаких реальных ИНН, телефонов, паролей, access/refresh-токенов и чеков в коде, тестах, фикстурах и коммитах. В примерах только явно фейковые значения вроде `000000000000` и `test-password`.
- Все HTTP-запросы в тестах только через мок глобального `fetch`. Не вызывать `lknpd.nalog.ru` и не добавлять интеграционные тесты с боевым кабинетом.
- Эндпоинты и формат тел запросов не менять без сверки с актуальными клиентами API и без описания расхождений. Сомнение — не менять код, а описать находку.
