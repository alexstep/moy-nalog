const { mock, describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const requests = []
let routes = {}

function jsonResponse (body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  }
}

async function fakeFetch (url, options = {}) {
  const entry = {
    url: String(url),
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body ? JSON.parse(options.body) : undefined
  }
  requests.push(entry)

  const handler = routes[entry.url]
  if (!handler) {
    throw new Error('Неожиданный HTTP-запрос в тесте: ' + entry.method + ' ' + entry.url)
  }
  return handler(entry)
}

mock.module('cross-fetch', {
  defaultExport: fakeFetch
})

const NalogAPI = require('../index.js')

const API = 'https://lknpd.nalog.ru/api/v1'
const LOGIN = '000000000000'
const PASSWORD = 'test-password'

function futureIso (offsetMs = 60 * 60 * 1000) {
  return new Date(Date.now() + offsetMs).toISOString()
}

function authPayload (expireIn = futureIso()) {
  return {
    token: 'access-token',
    refreshToken: 'refresh-token',
    tokenExpireIn: expireIn,
    profile: { inn: LOGIN }
  }
}

beforeEach(() => {
  requests.length = 0
  routes = {
    [API + '/auth/lkfl']: () => jsonResponse(authPayload())
  }
})

// getToken смотрит срок токена до await authPromise. Если вызвать метод,
// пока авторизация ещё не завершилась, библиотека сразу идёт в /auth/token.
// В сценариях ниже сначала дожидаемся authPromise и проверяем уже выданный токен.

describe('конструктор', () => {
  it('требует логин и пароль, если autologin не выключен', () => {
    assert.throws(() => new NalogAPI({ password: PASSWORD }), SyntaxError)
    assert.throws(() => new NalogAPI({}), SyntaxError)
    assert.equal(requests.length, 0)
  })

  it('не ходит в сеть при autologin: false', () => {
    const api = new NalogAPI({ autologin: false })
    assert.equal(api.authPromise, null)
    assert.equal(api.token, '')
    assert.equal(requests.length, 0)
  })
})

describe('auth', () => {
  it('отправляет логин и пароль на /auth/lkfl и сохраняет токены', async () => {
    const api = new NalogAPI({ autologin: false })
    const response = await api.auth(LOGIN, PASSWORD)

    assert.equal(requests.length, 1)
    const req = requests[0]
    assert.equal(req.url, API + '/auth/lkfl')
    assert.equal(req.method, 'POST')
    assert.equal(req.headers['content-type'], 'application/json')
    assert.equal(req.body.username, LOGIN)
    assert.equal(req.body.password, PASSWORD)
    assert.equal(req.body.deviceInfo.sourceType, 'WEB')
    assert.equal(req.body.deviceInfo.appVersion, '1.0.0')
    assert.equal(req.body.deviceInfo.sourceDeviceId, api.sourceDeviceId)
    assert.equal(typeof req.body.deviceInfo.metaDetails.userAgent, 'string')

    assert.equal(response.refreshToken, 'refresh-token')
    assert.equal(api.token, 'access-token')
    assert.equal(api.refreshToken, 'refresh-token')
    assert.equal(api.INN, LOGIN)
    assert.ok(api.tokenExpireIn)
  })

  it('отклоняет промис, если в ответе нет refreshToken', async () => {
    routes[API + '/auth/lkfl'] = () => jsonResponse({ message: 'Неверный логин или пароль' })
    const api = new NalogAPI({ autologin: false })

    await assert.rejects(
      () => api.auth(LOGIN, PASSWORD),
      /Неверный логин или пароль/
    )
    assert.equal(api.token, '')
  })

  it('повторный вызов не отправляет второй запрос', async () => {
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    const again = await api.auth(LOGIN, PASSWORD)

    assert.equal(requests.length, 1)
    assert.equal(again.refreshToken, 'refresh-token')
  })
})

describe('getToken', () => {
  it('без авторизации завершается ошибкой и не делает HTTP-запрос', async () => {
    const api = new NalogAPI({ autologin: false })
    await assert.rejects(() => api.getToken(), /Необходимо сначала авторизоваться/)
    assert.equal(requests.length, 0)
  })

  it('возвращает сохранённый токен, пока до истечения больше минуты', async () => {
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    const token = await api.getToken()
    assert.equal(token, 'access-token')
    assert.equal(requests.length, 1)
  })

  it('обновляет токен через /auth/token, когда срок почти вышел', async () => {
    routes[API + '/auth/lkfl'] = () => jsonResponse(authPayload(futureIso(30 * 1000)))
    routes[API + '/auth/token'] = () => jsonResponse({
      token: 'access-token-2',
      refreshToken: 'refresh-token-2',
      tokenExpireIn: futureIso()
    })

    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise
    const token = await api.getToken()

    assert.equal(token, 'access-token-2')
    assert.equal(api.refreshToken, 'refresh-token-2')
    const refresh = requests.find(req => req.url === API + '/auth/token')
    assert.ok(refresh)
    assert.equal(refresh.method, 'POST')
    assert.equal(refresh.body.refreshToken, 'refresh-token')
    assert.equal(refresh.body.deviceInfo.sourceDeviceId, api.sourceDeviceId)
    assert.equal(refresh.body.deviceInfo.sourceType, 'WEB')
  })
})

describe('получение данных', () => {
  it('userInfo запрашивает GET /user с Bearer-токеном', async () => {
    routes[API + '/user'] = () => jsonResponse({ id: 1, inn: LOGIN, displayName: 'Тест' })
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    const profile = await api.userInfo()

    assert.equal(profile.id, 1)
    const req = requests.find(item => item.url === API + '/user')
    assert.equal(req.method, 'GET')
    assert.equal(req.body, undefined)
    assert.equal(req.headers.authorization, 'Bearer access-token')
  })
})

describe('addIncome', () => {
  const receiptUrl = API + '/receipt/' + LOGIN + '/receipt-uuid-1/json'

  beforeEach(() => {
    routes[API + '/income'] = () => jsonResponse({ approvedReceiptUuid: 'receipt-uuid-1' })
    routes[receiptUrl] = () => jsonResponse({ receiptId: 'receipt-uuid-1', totalAmount: 21 })
  })

  it('регистрирует доход и подгружает JSON чека', async () => {
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise
    const soldAt = new Date('2024-05-06T12:00:00Z')
    const receipt = await api.addIncome({
      name: 'Консультация',
      amount: 10.5,
      quantity: 2,
      date: soldAt
    })

    const income = requests.find(req => req.url === API + '/income')
    assert.equal(income.method, 'POST')
    assert.equal(income.headers.authorization, 'Bearer access-token')
    assert.equal(income.body.paymentType, 'CASH')
    assert.equal(income.body.client.incomeType, 'FROM_INDIVIDUAL')
    assert.equal(income.body.client.inn, null)
    assert.equal(income.body.services.length, 1)
    assert.equal(income.body.services[0].name, 'Консультация')
    assert.equal(income.body.services[0].amount, 10.5)
    assert.equal(income.body.services[0].quantity, 2)
    assert.equal(income.body.totalAmount, '21.00')
    assert.equal(income.body.operationTime, api.dateToLocalISO(soldAt))

    assert.equal(receipt.id, 'receipt-uuid-1')
    assert.equal(receipt.approvedReceiptUuid, 'receipt-uuid-1')
    assert.equal(receipt.jsonUrl, receiptUrl)
    assert.equal(receipt.printUrl, API + '/receipt/' + LOGIN + '/receipt-uuid-1/print')
    assert.deepEqual(receipt.data, { receiptId: 'receipt-uuid-1', totalAmount: 21 })

    const receiptReq = requests.find(req => req.url === receiptUrl)
    assert.equal(receiptReq.method, 'GET')
    assert.equal(receiptReq.headers.authorization, undefined)
  })

  it('возвращает error, если чек не подтверждён', async () => {
    routes[API + '/income'] = () => jsonResponse({ message: 'отказ' })
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    const result = await api.addIncome({ name: 'Услуга', amount: 10 })

    assert.deepEqual(result, { error: { message: 'отказ' } })
    assert.equal(requests.some(req => req.url.includes('/receipt/')), false)
  })
})

describe('отмена чека через call', () => {
  it('отправляет POST /cancel с переданным телом и Bearer-токеном', async () => {
    routes[API + '/cancel'] = () => jsonResponse({
      incomeInfo: { approvedReceiptUuid: 'receipt-uuid-1' }
    })
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise
    const operationTime = api.dateToLocalISO()

    const response = await api.call('cancel', {
      receiptUuid: 'receipt-uuid-1',
      comment: 'CANCEL',
      partnerCode: null,
      operationTime,
      requestTime: operationTime
    })

    assert.equal(response.incomeInfo.approvedReceiptUuid, 'receipt-uuid-1')
    const req = requests.find(item => item.url === API + '/cancel')
    assert.equal(req.method, 'POST')
    assert.equal(req.headers.authorization, 'Bearer access-token')
    assert.equal(req.body.receiptUuid, 'receipt-uuid-1')
    assert.equal(req.body.comment, 'CANCEL')
    assert.equal(req.body.partnerCode, null)
    assert.equal(req.body.operationTime, operationTime)
  })

  it('при наличии payload игнорирует явно переданный GET и шлёт POST', async () => {
    routes[API + '/cancel'] = () => jsonResponse({ ok: true })
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    await api.call('cancel', { receiptUuid: 'receipt-uuid-1' }, 'GET')

    const req = requests.find(item => item.url === API + '/cancel')
    assert.equal(req.method, 'POST')
  })
})

describe('dateToLocalISO', () => {
  it('возвращает локальную дату со смещением', () => {
    const api = new NalogAPI({ autologin: false })
    const formatted = api.dateToLocalISO(new Date('2024-01-02T03:04:05Z'))
    assert.match(formatted, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })
})
