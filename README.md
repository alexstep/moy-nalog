# Создание чеков в налоговой
Неофициальная обёртка для API сервиса lknpd.nalog.ru на nodejs.

Реализия на php - https://github.com/shoman4eg/moy-nalog

Служит для автоматизации отправки информации о доходах самозанятых и получения информации о созданных чеках.

Подбробную информацию о налоге на профессиональный доход и правил выдачи чеков можете посмотреть по ссылкам в [wiki](https://github.com/alexstep/moy-nalog/wiki)

![codeexample](https://user-images.githubusercontent.com/1881684/111181224-cd534900-85be-11eb-92b2-1cdc8f9fc80e.png)


## Использование
Установите пакет. Нужен Node.js 18 или новее: запросы идут через встроенный `fetch`.
```bash
npm i moy-nalog
```


Инициализаци и авторизация
```javascript
const moyNalog = require('moy-nalog')

const nalogAPI = new moyNalog({ username:'23456789', password: 'your_pass' })
```

Отправка информации о доходе
```javascript
nalogAPI.addIncome({ name:'Предоставление информационных услуг', amount: 99.99 }).then( receipt => {
  console.log(receipt.id, receipt.data)

  // ссылка на картинку с чеком
  return receipt.printUrl
}).catch(console.error)
```

### Примеры
Вызов произвольного метода api (см. network в devtools на сайте lknpd.nalog.ru)
```javascript
const stats = await nalogAPI.call('incomes/summary').catch(console.error)
```

Пример расширенного добавления дохода
```javascript
  const response = await nalogAPI.call('income', {
    paymentType: 'CASH',
    inn: null,
    ignoreMaxTotalIncomeRestriction: false,
    client: { contactPhone: null, displayName: null, incomeType: 'FROM_INDIVIDUAL' },

    requestTime: nalogAPI.dateToLocalISO(),
    operationTime: nalogAPI.dateToLocalISO(new Date('2021-03-08 12:42')),

    services: [{
      name: 'Предоставление информационных услуг #' + orderId,
      amount: 99.99,
      quantity: 1
    }],

    totalAmount: 99.99
  }).catch(console.error)

  console.log(response)

```


[Подробное описание методов класса](/docs/nalogAPIClass.md)

## Разработка

Исходники на TypeScript, в каталоге `src/`. Сборка и тесты запускаются через [Bun](https://bun.sh). Пользователям пакета Bun не нужен: в npm попадает `dist/` с ESM, CommonJS и сгенерированными типами. `require('moy-nalog')` по-прежнему возвращает класс.

```bash
bun install
bun test
bun run lint
bun run typecheck
bun run build
node scripts/smoke-node.mjs
```

`bun test` подменяет глобальный `fetch` и не обращается к lknpd.nalog.ru. `node scripts/smoke-node.mjs` пакует собранный пакет и проверяет `require` и `import` обычным Node.js.

## Донаты
Если вам помогла эта библиотка можете [пожертвовать автору немного денег](https://yoomoney.ru/to/41001265749624  )


