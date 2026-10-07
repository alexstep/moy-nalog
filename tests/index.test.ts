import { beforeEach, describe, expect, it } from 'bun:test'
import NalogAPI from '../src/index.ts'

interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

const requests: CapturedRequest[] = []
let routes: Record<string, () => Response | Promise<Response>> = {}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const API = 'https://lknpd.nalog.ru/api/v1'
const LOGIN = '000000000000'
const PASSWORD = 'test-password'

function futureIso(offsetMs = 60 * 60 * 1000): string {
  return new Date(Date.now() + offsetMs).toISOString()
}

function authPayload(expireIn = futureIso()) {
  return {
    token: 'access-token',
    refreshToken: 'refresh-token',
    tokenExpireIn: expireIn,
    profile: { inn: LOGIN },
  }
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const headers = (init?.headers ?? {}) as Record<string, string>
  const entry: CapturedRequest = {
    url,
    method: init?.method ?? 'GET',
    headers,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  }
  requests.push(entry)

  const handler = routes[url]
  if (!handler) {
    throw new Error(
      `Неожиданный HTTP-запрос в тесте: ${entry.method} ${entry.url}`,
    )
  }
  return handler()
}) as typeof fetch

beforeEach(() => {
  requests.length = 0
  routes = {
    [`${API}/auth/lkfl`]: () => jsonResponse(authPayload()),
  }
})

// getToken смотрит срок токена до await authPromise. Если вызвать метод,
// пока авторизация ещё не завершилась, библиотека сразу идёт в /auth/token.
// В сценариях ниже сначала дожидаемся authPromise и проверяем уже выданный токен.

describe('конструктор', () => {
  it('требует логин и пароль, если autologin не выключен', () => {
    expect(() => new NalogAPI({ password: PASSWORD })).toThrow(SyntaxError)
    expect(() => new NalogAPI({})).toThrow(SyntaxError)
    expect(requests.length).toBe(0)
  })

  it('не ходит в сеть при autologin: false', () => {
    const api = new NalogAPI({ autologin: false })
    expect(api.authPromise).toBeNull()
    expect(api.token).toBe('')
    expect(requests.length).toBe(0)
  })
})

describe('auth', () => {
  it('отправляет логин и пароль на /auth/lkfl и сохраняет токены', async () => {
    const api = new NalogAPI({ autologin: false })
    const response = await api.auth(LOGIN, PASSWORD)

    expect(requests.length).toBe(1)
    const req = requests[0]
    expect(req).toBeDefined()
    if (!req) return
    expect(req.url).toBe(`${API}/auth/lkfl`)
    expect(req.method).toBe('POST')
    expect(req.headers['content-type']).toBe('application/json')
    expect(req.body).toMatchObject({
      username: LOGIN,
      password: PASSWORD,
      deviceInfo: {
        sourceType: 'WEB',
        appVersion: '1.0.0',
        sourceDeviceId: api.sourceDeviceId,
      },
    })
    const body = req.body as {
      deviceInfo: { metaDetails: { userAgent: string } }
    }
    expect(typeof body.deviceInfo.metaDetails.userAgent).toBe('string')

    expect(response.refreshToken).toBe('refresh-token')
    expect(api.token).toBe('access-token')
    expect(api.refreshToken).toBe('refresh-token')
    expect(api.INN).toBe(LOGIN)
    expect(api.tokenExpireIn).toBeTruthy()
  })

  it('отклоняет промис, если в ответе нет refreshToken', async () => {
    routes[`${API}/auth/lkfl`] = () =>
      jsonResponse({ message: 'Неверный логин или пароль' })
    const api = new NalogAPI({ autologin: false })

    await expect(api.auth(LOGIN, PASSWORD)).rejects.toThrow(
      /Неверный логин или пароль/,
    )
    expect(api.token).toBe('')
  })

  it('повторный вызов не отправляет второй запрос', async () => {
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    const again = await api.auth(LOGIN, PASSWORD)

    expect(requests.length).toBe(1)
    expect(again.refreshToken).toBe('refresh-token')
  })
})

describe('getToken', () => {
  it('без авторизации завершается ошибкой и не делает HTTP-запрос', async () => {
    const api = new NalogAPI({ autologin: false })
    await expect(api.getToken()).rejects.toThrow(
      /Необходимо сначала авторизоваться/,
    )
    expect(requests.length).toBe(0)
  })

  it('возвращает сохранённый токен, пока до истечения больше минуты', async () => {
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    const token = await api.getToken()
    expect(token).toBe('access-token')
    expect(requests.length).toBe(1)
  })

  it('обновляет токен через /auth/token, когда срок почти вышел', async () => {
    routes[`${API}/auth/lkfl`] = () =>
      jsonResponse(authPayload(futureIso(30 * 1000)))
    routes[`${API}/auth/token`] = () =>
      jsonResponse({
        token: 'access-token-2',
        refreshToken: 'refresh-token-2',
        tokenExpireIn: futureIso(),
      })

    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise
    const token = await api.getToken()

    expect(token).toBe('access-token-2')
    expect(api.refreshToken).toBe('refresh-token-2')
    const refresh = requests.find((req) => req.url === `${API}/auth/token`)
    expect(refresh).toBeDefined()
    expect(refresh?.method).toBe('POST')
    expect(refresh?.body).toMatchObject({
      refreshToken: 'refresh-token',
      deviceInfo: {
        sourceDeviceId: api.sourceDeviceId,
        sourceType: 'WEB',
      },
    })
  })
})

describe('получение данных', () => {
  it('userInfo запрашивает GET /user с Bearer-токеном', async () => {
    routes[`${API}/user`] = () =>
      jsonResponse({ id: 1, inn: LOGIN, displayName: 'Тест' })
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    const profile = await api.userInfo()

    expect(profile.id).toBe(1)
    const req = requests.find((item) => item.url === `${API}/user`)
    expect(req?.method).toBe('GET')
    expect(req?.body).toBeUndefined()
    expect(req?.headers.authorization).toBe('Bearer access-token')
  })
})

describe('addIncome', () => {
  const receiptUrl = `${API}/receipt/${LOGIN}/receipt-uuid-1/json`

  beforeEach(() => {
    routes[`${API}/income`] = () =>
      jsonResponse({ approvedReceiptUuid: 'receipt-uuid-1' })
    routes[receiptUrl] = () =>
      jsonResponse({ receiptId: 'receipt-uuid-1', totalAmount: 21 })
  })

  it('регистрирует доход и подгружает JSON чека', async () => {
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise
    const soldAt = new Date('2024-05-06T12:00:00Z')
    const receipt = await api.addIncome({
      name: 'Консультация',
      amount: 10.5,
      quantity: 2,
      date: soldAt,
    })

    const income = requests.find((req) => req.url === `${API}/income`)
    expect(income?.method).toBe('POST')
    expect(income?.headers.authorization).toBe('Bearer access-token')
    expect(income?.body).toMatchObject({
      paymentType: 'CASH',
      client: { incomeType: 'FROM_INDIVIDUAL', inn: null },
      services: [{ name: 'Консультация', amount: 10.5, quantity: 2 }],
      totalAmount: '21.00',
      operationTime: api.dateToLocalISO(soldAt),
    })
    const incomeBody = income?.body as { services: unknown[] }
    expect(incomeBody.services.length).toBe(1)

    expect(receipt).toMatchObject({
      id: 'receipt-uuid-1',
      approvedReceiptUuid: 'receipt-uuid-1',
      jsonUrl: receiptUrl,
      printUrl: `${API}/receipt/${LOGIN}/receipt-uuid-1/print`,
      data: { receiptId: 'receipt-uuid-1', totalAmount: 21 },
    })

    const receiptReq = requests.find((req) => req.url === receiptUrl)
    expect(receiptReq?.method).toBe('GET')
    expect(receiptReq?.headers.authorization).toBeUndefined()
  })

  it('возвращает error, если чек не подтверждён', async () => {
    routes[`${API}/income`] = () => jsonResponse({ message: 'отказ' })
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    const result = await api.addIncome({ name: 'Услуга', amount: 10 })

    expect(result).toEqual({ error: { message: 'отказ' } })
    expect(requests.some((req) => req.url.includes('/receipt/'))).toBe(false)
  })
})

describe('отмена чека через call', () => {
  it('отправляет POST /cancel с переданным телом и Bearer-токеном', async () => {
    routes[`${API}/cancel`] = () =>
      jsonResponse({
        incomeInfo: { approvedReceiptUuid: 'receipt-uuid-1' },
      })
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise
    const operationTime = api.dateToLocalISO()

    const response = await api.call('cancel', {
      receiptUuid: 'receipt-uuid-1',
      comment: 'CANCEL',
      partnerCode: null,
      operationTime,
      requestTime: operationTime,
    })

    expect(response.incomeInfo.approvedReceiptUuid).toBe('receipt-uuid-1')
    const req = requests.find((item) => item.url === `${API}/cancel`)
    expect(req?.method).toBe('POST')
    expect(req?.headers.authorization).toBe('Bearer access-token')
    expect(req?.body).toMatchObject({
      receiptUuid: 'receipt-uuid-1',
      comment: 'CANCEL',
      partnerCode: null,
      operationTime,
    })
  })

  it('при наличии payload игнорирует явно переданный GET и шлёт POST', async () => {
    routes[`${API}/cancel`] = () => jsonResponse({ ok: true })
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    await api.call('cancel', { receiptUuid: 'receipt-uuid-1' }, 'GET')

    const req = requests.find((item) => item.url === `${API}/cancel`)
    expect(req?.method).toBe('POST')
  })
})

describe('dateToLocalISO', () => {
  it('возвращает локальную дату со смещением', () => {
    const api = new NalogAPI({ autologin: false })
    const formatted = api.dateToLocalISO(new Date('2024-01-02T03:04:05Z'))
    expect(formatted).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    )
  })
})
