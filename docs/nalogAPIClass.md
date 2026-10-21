<a name="NalogAPI"></a>

## NalogAPI
Добавление продаж / создание чеков прихода
в МойНалог https://lknpd.nalog.ru/

**Kind**: global class  
**Use**: ```const nalog = new NalogAPI({ autologin: false })```

  ```await nalog.auth('000000000000', 'test-password')```

  ```await nalog.userInfo()```

`JSON.stringify(nalog)` не включает `token` и `refreshToken`. Поля по-прежнему доступны напрямую.  
**Properties**

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| apiUrl | <code>string</code> | <code>&quot;https://lknpd.nalog.ru/api/v1&quot;</code> | endpoint api личного кабинета |
| INN | <code>string</code> | <code>&quot;&#x27;&#x27;&quot;</code> | доступны после авторизации |
| token | <code>string</code> | <code>&quot;&#x27;&#x27;&quot;</code> | доступны после авторизации |
| tokenExpireIn | <code>string</code> | <code>&quot;&#x27;&#x27;&quot;</code> | доступны после авторизации |
| refreshToken | <code>string</code> | <code>&quot;&#x27;&#x27;&quot;</code> | доступны после авторизации |
| authPromise | <code>Promise</code> | <code></code> | промис для ожидания завершения авторизации |


* [NalogAPI](#NalogAPI)
    * [new NalogAPI(options)](#new_NalogAPI_new)
    * [.createDeviceId()](#NalogAPI+createDeviceId)
    * [.auth(login, password)](#NalogAPI+auth) ⇒ <code>Promise(object)</code>
    * [.getToken()](#NalogAPI+getToken) ⇒ <code>Promise(string)</code>
    * [.call(endpoint, payload, method)](#NalogAPI+call) ⇒ <code>Promise(object)</code>
    * [.addIncome(date, name, amount)](#NalogAPI+addIncome) ⇒ <code>Promise({id,printUrl,jsonUrl,data,approvedReceiptUuid})</code>
    * [.userInfo()](#NalogAPI+userInfo) ⇒ <code>Promise(object)</code>

<a name="new_NalogAPI_new"></a>

### new NalogAPI(options)

Опции передаются объектом, не позиционными аргументами.

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| options.login | <code>string</code> |  | логин. В примерах только <code>000000000000</code> |
| options.password | <code>string</code> |  | пароль. В примерах только <code>test-password</code> |
| options.autologin | <code>boolean</code> | <code>true</code> | сразу вызывать auth. Без login и password конструктор бросает SyntaxError |
| options.timeoutMs | <code>number</code> | <code>30000</code> | таймаут одного HTTP-запроса, миллисекунды |

<a name="NalogAPI+createDeviceId"></a>

### nalogAPI.createDeviceId()
Генерирует UUID устройства через `crypto.randomUUID()`. Идентификатор уходит в `deviceInfo.sourceDeviceId`.

**Kind**: instance method of [<code>NalogAPI</code>](#NalogAPI)  
<a name="NalogAPI+auth"></a>

### nalogAPI.auth(login, password) ⇒ <code>Promise(object)</code>
Авторизация пользователя
Получение refreshToken

**Kind**: instance method of [<code>NalogAPI</code>](#NalogAPI)  
**Returns**: <code>Promise(object)</code> - - ответ метода /auth/  

| Param | Type |
| --- | --- |
| login | <code>string</code> | 
| password | <code>string</code> | 

<a name="NalogAPI+getToken"></a>

### nalogAPI.getToken() ⇒ <code>Promise(string)</code>
Получение token по refreshToken

**Kind**: instance method of [<code>NalogAPI</code>](#NalogAPI)  
<a name="NalogAPI+call"></a>

### nalogAPI.call(endpoint, payload, method) ⇒ <code>Promise(object)</code>
Вызов метода api

**Kind**: instance method of [<code>NalogAPI</code>](#NalogAPI)  
**Returns**: <code>Promise(object)</code> - - json ответа сервера  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| endpoint | <code>string</code> |  | url метода без слэша в начале (например `user`) |
| payload | <code>object</code> |  | данные для отправки в body |
| method | <code>enum</code> | <code>&#x27;GET&#x27;</code> |  |

<a name="NalogAPI+addIncome"></a>

### nalogAPI.addIncome(date, name, amount) ⇒ <code>Promise({id,printUrl,jsonUrl,data,approvedReceiptUuid})</code>
Добавления "прихода"

**Kind**: instance method of [<code>NalogAPI</code>](#NalogAPI)  
**Returns**: <code>Promise({id,printUrl,jsonUrl,data,approvedReceiptUuid})</code> - созданный чек, либо <code>{ error }</code>, если чек не подтверждён. Если чек уже создан, а JSON чека не загрузился, промис выполняется: <code>data</code> остаётся <code>undefined</code>.  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| date | <code>date</code> \| <code>string</code> | <code>now</code> | время поступления денег |
| name |  |  | название товара/услуги |
| amount |  |  | стоимость |

<a name="NalogAPI+userInfo"></a>

### nalogAPI.userInfo() ⇒ <code>Promise(object)</code>
Информация о пользователе

**Kind**: instance method of [<code>NalogAPI</code>](#NalogAPI)  
