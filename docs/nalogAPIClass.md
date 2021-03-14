<a name="NalogAPI"></a>

## NalogAPI
Добавление продаж / создание чеков прихода
в МойНалог https://lknpd.nalog.ru/

**Kind**: global class  
**Use**: ```const nalog = NalogAPI({autologin:false})```

  ```nalog.auth('301103735862','mypass')```

  ```console.log(authPromise)```

  ```await nalog.userInfo()```

  ```console.log(authPromise)```  
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
    * [new NalogAPI(login, password, autologin)](#new_NalogAPI_new)
    * [.createDeviceId()](#NalogAPI+createDeviceId)
    * [.auth(username, password)](#NalogAPI+auth) ⇒ <code>Promise(object)</code>
    * [.getToken()](#NalogAPI+getToken) ⇒ <code>Promise(string)</code>
    * [.call(endpoint, payload, method)](#NalogAPI+call) ⇒ <code>Promise(object)</code>
    * [.addIncome(date, name, amount)](#NalogAPI+addIncome) ⇒ <code>Promise({id,printUrl,jsonUrl,data,approvedReceiptUuid})</code>
    * [.userInfo()](#NalogAPI+userInfo) ⇒ <code>Promise(object)</code>

<a name="new_NalogAPI_new"></a>

### new NalogAPI(login, password, autologin)

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| login | <code>string</code> |  | логин(обычно ИНН) от личного кабинета |
| password | <code>string</code> |  | пароль |
| autologin | <code>boolean</code> | <code>true</code> | сразу запускать .auth в конструкторе класса |

<a name="NalogAPI+createDeviceId"></a>

### nalogAPI.createDeviceId()
Генерирует 21 символьный идентификатор "устройства" требующийся для авторизации

**Kind**: instance method of [<code>NalogAPI</code>](#NalogAPI)  
<a name="NalogAPI+auth"></a>

### nalogAPI.auth(username, password) ⇒ <code>Promise(object)</code>
Авторизация пользователя
Получение refreshToken

**Kind**: instance method of [<code>NalogAPI</code>](#NalogAPI)  
**Returns**: <code>Promise(object)</code> - - ответ метода /auth/  

| Param | Type |
| --- | --- |
| username | <code>string</code> | 
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
| method | <code>enum</code> | <code>&#x27;POST&#x27;</code> |  |

<a name="NalogAPI+addIncome"></a>

### nalogAPI.addIncome(date, name, amount) ⇒ <code>Promise({id,printUrl,jsonUrl,data,approvedReceiptUuid})</code>
Добавления "прихода"

**Kind**: instance method of [<code>NalogAPI</code>](#NalogAPI)  
**Returns**: <code>Promise({id,printUrl,jsonUrl,data,approvedReceiptUuid})</code> - - информация о созданном чеке, либо об ошибке  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| date | <code>date</code> \| <code>string</code> | <code>now</code> | время поступления денег |
| name |  |  | название товара/услуги |
| amount |  |  | стоимость |

<a name="NalogAPI+userInfo"></a>

### nalogAPI.userInfo() ⇒ <code>Promise(object)</code>
Информация о пользователе

**Kind**: instance method of [<code>NalogAPI</code>](#NalogAPI)  
