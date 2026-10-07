# Агентам по репозиторию moy-nalog

Неофициальная Node.js-обёртка над API личного кабинета [lknpd.nalog.ru](https://lknpd.nalog.ru/) («Мой налог») для самозанятых. Пакет публикуется в npm как `moy-nalog`. Им пользуются люди: не ломайте публичный API и не отправляйте запросы в налоговую из тестов.

## Структура

- `index.js` — класс `NalogAPI`, единственная точка входа (`require('moy-nalog')`).
- `index.d.ts` — типы публичного API. Поле `types` в `package.json` указывает сюда.
- `tests/index.test.js` — тесты на `node:test`. HTTP только через мок `cross-fetch`.
- `docs/nalogAPIClass.md` — описание методов, генерируется командой `npm run docs`.
- `.github/workflows/ci.yml` — lint и тесты на актуальных LTS Node.
- `.github/workflows/npmpublish.yml` — публикация в npm только по тегу `v*`. Самим не публиковать.

Базовый URL API задан в коде: `https://lknpd.nalog.ru/api/v1`. Методы, которые библиотека вызывает сама: `POST /auth/lkfl`, `POST /auth/token`, `GET /user`, `POST /income`, `GET /receipt/{inn}/{uuid}/json`. Произвольный путь можно послать через `call(endpoint, payload, method)`.

## Зависимости, тесты, линт

Нужен Node.js 22 или 24 (текущие LTS). Менеджер пакетов — npm, lockfile коммитится.

```bash
npm ci
npm test
npm run lint
```

`npm test` запускает `node --test` с `--test-concurrency=1` и не ходит в сеть. Секрет `USERPASS` и живой аккаунт налогоплательщика для тестов не нужны. Конкурентность тестов оставляйте выключенной: мок `cross-fetch` общий на файл.

Документацию методов пересобирают так: `npm run docs`. Перед этим смотрите diff `docs/nalogAPIClass.md`: команда перезаписывает файл целиком.

## Правила

- Не ломать публичный API: конструктор `{ login, password, autologin }`, методы `auth`, `getToken`, `call`, `addIncome`, `userInfo`, `dateToLocalISO`, поля `apiUrl`, `INN`, `token`, `tokenExpireIn`, `refreshToken`, `authPromise`, `sourceDeviceId`. Новые поля в ответах допустимы, переименование и смена смысла существующих — нет.
- Версию в `package.json` не менять и в npm не публиковать, пока это явно не попросили. Публикация в workflow привязана к тегу `v*`.
- Никаких реальных ИНН, телефонов, паролей, access/refresh-токенов и чеков в коде, тестах, фикстурах и коммитах. В примерах только явно фейковые значения вроде `000000000000` и `test-password`.
- Все HTTP-запросы в тестах только через моки. Не вызывать `lknpd.nalog.ru` и не добавлять интеграционные тесты с боевым кабинетом.
- Эндпоинты и формат тел запросов не менять без сверки с актуальными клиентами API и без описания расхождений. Сомнение — не менять код, а описать находку.
