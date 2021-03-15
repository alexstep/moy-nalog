# Отправка чеков в налоговую
Неофициальная обёртка для API сервиса lknpd.nalog.ru

Пригодится для автоматизации отправки информации о доходах самозанятых.


## Использование

Установите пакет
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
})
```

### Примеры
Вызов произвольного метода api (см. network в devtools на сайте lknpd.nalog.ru)
```javascript
const stats = await nalogAPI.call('incomes/summary')
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
  })

  console.log(response)

```


[Подробное описание методов класса](/docs/nalogAPIClass.md)


