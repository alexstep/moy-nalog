# Создание чеков в налоговой
Неофициальная обёртка для API сервиса lknpd.nalog.ru

Служит для автоматизации отправки информации о доходах самозанятых и получения информации о созданных чеках.

Подбробную информацию о налоге на профессиональный доход и правил выдачи чеков можете посмотреть по ссылкам в [wiki](https://github.com/alexstep/moy-nalog/wiki)

![codeexample](https://user-images.githubusercontent.com/1881684/111181224-cd534900-85be-11eb-92b2-1cdc8f9fc80e.png)


## Использование
Установите пакет
```bash
npm i npd-api
```


Инициализаци и авторизация
```javascript
const moyNalog = require('npd-api')

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
