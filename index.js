const fetch = require('cross-fetch')

/**
 * Добавление продаж / создание чеков прихода
 * в МойНалог https://lknpd.nalog.ru/
 * @param {string} login - логин(обычно ИНН) от личного кабинета
 * @param {string} password - пароль
 * @param {boolean} autologin=true - сразу запускать .auth в конструкторе класса
 * @property {string} apiUrl=https://lknpd.nalog.ru/api/v1 - endpoint api личного кабинета
 * @property {string} INN=''  - доступны после авторизации
 * @property {string} token='' - доступны после авторизации
 * @property {string} tokenExpireIn='' - доступны после авторизации
 * @property {string} refreshToken='' - доступны после авторизации
 * @property {Promise} authPromise=null - промис для ожидания завершения авторизации
 * @use ```const nalog = NalogAPI({autologin:false})```
 *
 *   ```nalog.auth('301103735862','mypass')```
 *
 *   ```console.log(authPromise)```
 *
 *   ```await nalog.userInfo()```
 *
 *   ```console.log(authPromise)```
 */
class NalogAPI {
  constructor ({ login, password, autologin = true }) {
    if (autologin && (!login || !password)) {
      throw new SyntaxError('NalogAPI required login+password for auth')
    }

    this.apiUrl = 'https://lknpd.nalog.ru/api/v1'
    this.sourceDeviceId = this.createDeviceId()

    // Для ожидания завершения авторизации перед отправкой других запросов к api
    this.authPromise = null

    // будут получены после авторизации
    this.INN = ''
    this.token = ''
    this.tokenExpireIn = ''
    this.refreshToken = ''

    if (autologin) {
      this.auth(login, password)
    }
  }

  /**
   * Генерирует 21 символьный идентификатор "устройства" требующийся для авторизации
   */
  createDeviceId () {
    return (Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15))
  }

  /**
   * Авторизация пользователя
   * Получение refreshToken
   * @param {string} login
   * @param {string} password
   * @returns {Promise(object)} - ответ метода /auth/
   */
  auth (login, password) {
    if (this.authPromise) { return this.authPromise }

    this.authPromise = fetch(this.apiUrl + '/auth/lkfl', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'content-type': 'application/json',
      },
      referrer: 'https://lknpd.nalog.ru/',
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: JSON.stringify({
        username: login,
        password: password,
        deviceInfo: {
          sourceDeviceId: this.sourceDeviceId,
          sourceType: 'WEB',
          appVersion: '1.0.0',
          metaDetails: {
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.192 Safari/537.36'
          }
        }
      })
    }).then(r => r.json()).then(response => {
      if (!response.refreshToken) {
        throw new Error((response.message || 'Не получилось авторизоваться'))
      }
      this.INN = response.profile.inn
      this.token = response.token
      this.tokenExpireIn = response.tokenExpireIn
      this.refreshToken = response.refreshToken
      return response
    }).catch(err => {
      throw err
    })

    return this.authPromise
  }

  /**
   * Получение token по refreshToken
   * @returns {Promise(string)}
   */
  async getToken () {
    if (this.token && this.tokenExpireIn && new Date().getTime() + 60 * 1000 < new Date(this.tokenExpireIn).getTime()) {
      return this.token
    }

    if (!this.authPromise) {
      throw new Error('Необходимо сначала авторизоваться')
    }
    await this.authPromise

    const tokenPayload = {
      deviceInfo: {
        appVersion: '1.0.0',
        sourceDeviceId: this.sourceDeviceId,
        sourceType: 'WEB',
        metaDetails: {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.192 Safari/537.36'
        }
      },
      refreshToken: this.refreshToken
    }

    const response = await fetch(this.apiUrl + '/auth/token', {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'content-type': 'application/json',
      },
      referrer: 'https://lknpd.nalog.ru/sales',
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: JSON.stringify(tokenPayload)
    }).then(r => r.json()).catch(console.error)

    if (response.refreshToken) { this.refreshToken = response.refreshToken }

    this.token = response.token
    this.tokenExpireIn = response.tokenExpireIn

    return this.token
  }

  /**
   * Вызов метода api
   * @param  {string} endpoint - url метода без слэша в начале (например `user`)
   * @param  {object} payload - данные для отправки в body
   * @param  {enum} method='GET'
   * @returns {Promise(object)} - json ответа сервера
   */
  async call (endpoint, payload, method = 'GET') {
    if (payload) { method = 'POST' }

    const params = {
      method: method,
      headers: {
        authorization: 'Bearer ' + (await this.getToken()),
        accept: 'application/json, text/plain, */*',
        'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'content-type': 'application/json',
      },
      referrer: 'https://lknpd.nalog.ru/sales/create',
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: JSON.stringify(payload)
    }

    if (method === 'GET') delete params.body

    return fetch(this.apiUrl + '/' + endpoint, params).then(r => r.json())
  }

  /**
   * Добавления "прихода"
   * @param  {date|string} date=now - время поступления денег
   * @param  {} name - название товара/услуги
   * @param  {} amount - стоимость
   * @returns {Promise({id,printUrl,jsonUrl,data,approvedReceiptUuid})} - информация о созданном чеке, либо об ошибке
   */
  async addIncome ({ date = new Date(), name, quantity = 1, amount }) {
    const response = await this.call('income', {
      paymentType: 'CASH',
      ignoreMaxTotalIncomeRestriction: false,
      client: { contactPhone: null, displayName: null, incomeType: 'FROM_INDIVIDUAL', inn: null },

      requestTime: this.dateToLocalISO(),
      operationTime: this.dateToLocalISO(date),

      services: [{
        name: name, // 'Предоставление информационных услуг #970/2495',
        amount: Number(amount.toFixed(2)),
        quantity: Number(quantity)
      }],

      totalAmount: (amount * quantity).toFixed(2)
    })

    if (!response || !response.approvedReceiptUuid) {
      return { error: response }
    }

    const result = {
      id: response.approvedReceiptUuid,
      approvedReceiptUuid: response.approvedReceiptUuid,
      jsonUrl: `${this.apiUrl}/receipt/${this.INN}/${response.approvedReceiptUuid}/json`,
      printUrl: `${this.apiUrl}/receipt/${this.INN}/${response.approvedReceiptUuid}/print`
    }
    result.data = await fetch(result.jsonUrl).then(r => r.json())

    return result
  }

  /**
   * Информация о пользователе
   * @returns {Promise(object)}
   */
  async userInfo () {
    return this.call('user')
  }

  dateToLocalISO (date = new Date()) {
    date = new Date(date)
    const off = date.getTimezoneOffset()
    const absoff = Math.abs(off)
    return (new Date(date.getTime() - off * 60 * 1000).toISOString().substr(0, 19) +
            (off > 0 ? '-' : '+') +
            (absoff / 60).toFixed(0).padStart(2, '0') + ':' +
            (absoff % 60).toString().padStart(2, '0'))
  }
}

module.exports = NalogAPI
