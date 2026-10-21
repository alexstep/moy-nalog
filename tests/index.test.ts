import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import NalogAPI from '../src/index.ts'

interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
  signal: AbortSignal | null
}

const requests: CapturedRequest[] = []
let routes: Record<string, () => Response | Promise<Response>> = {}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

async function finishWithSignal<T>(
  signal: AbortSignal | null | undefined,
  work: Promise<T>,
): Promise<T> {
  if (!signal) return work
  if (signal.aborted) throw abortReason(signal)
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
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
    signal: init?.signal ?? null,
  }
  requests.push(entry)

  const handler = routes[url]
  if (!handler) {
    throw new Error(
      `Неожиданный HTTP-запрос в тесте: ${entry.method} ${entry.url}`,
    )
  }
  return finishWithSignal(init?.signal, Promise.resolve(handler()))
}) as typeof fetch

beforeEach(() => {
  requests.length = 0
  routes = {
    [`${API}/auth/lkfl`]: () => jsonResponse(authPayload()),
  }
})

describe('конструктор', () => {
  it('требует логин и пароль, если autologin не выключен', () => {
    expect(() => new NalogAPI({ password: PASSWORD })).toThrow(SyntaxError)
    expect(() => new NalogAPI({})).toThrow(/login и password/)
    expect(requests.length).toBe(0)
  })

  it('даёт устройству UUID и не повторяет его', () => {
    const api = new NalogAPI({ autologin: false })
    expect(api.sourceDeviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(api.createDeviceId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(new NalogAPI({ autologin: false }).sourceDeviceId).not.toBe(
      api.sourceDeviceId,
    )
  })

  it('отклоняет неположительный timeoutMs', () => {
    expect(() => new NalogAPI({ autologin: false, timeoutMs: 0 })).toThrow(
      TypeError,
    )
    expect(requests).toHaveLength(0)
  })

  it('сохраняет token и refreshToken в JSON.stringify', () => {
    const api = new NalogAPI({ autologin: false })
    api.token = 'access-token'
    api.refreshToken = 'refresh-token'
    api.INN = LOGIN
    const parsed = JSON.parse(JSON.stringify(api)) as Record<string, unknown>
    expect(parsed.token).toBe('access-token')
    expect(parsed.refreshToken).toBe('refresh-token')
    expect(parsed.INN).toBe(LOGIN)
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

  it('не сохраняет токены из ответа с ошибочным статусом', async () => {
    routes[`${API}/auth/lkfl`] = () =>
      jsonResponse({ ...authPayload(), message: 'запрещено' }, 401)
    const api = new NalogAPI({ autologin: false })

    await expect(api.auth(LOGIN, PASSWORD)).rejects.toThrow(/запрещено/)
    expect(api.token).toBe('')
    expect(api.refreshToken).toBe('')
    expect(api.INN).toBe('')
    expect(api.authPromise).toBeNull()
  })

  it('отклоняет промис, если ответ авторизации не JSON', async () => {
    routes[`${API}/auth/lkfl`] = () =>
      new Response('<html>bad</html>', { status: 502 })
    const api = new NalogAPI({ autologin: false })

    await expect(api.auth(LOGIN, PASSWORD)).rejects.toThrow(/502/)
    expect(api.token).toBe('')
    expect(api.authPromise).toBeNull()
  })

  it('autologin не оставляет необработанный отказ входа', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (error: unknown) => {
      unhandled.push(error)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      routes[`${API}/auth/lkfl`] = () =>
        jsonResponse({ message: 'Неверный логин или пароль' }, 401)
      const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
      const pending = api.authPromise
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
      await expect(pending).rejects.toThrow(/Неверный логин или пароль/)
      expect(api.token).toBe('')
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('обрывает зависший вход по таймауту и не сохраняет токен', async () => {
    routes[`${API}/auth/lkfl`] = () => new Promise(() => {})
    const api = new NalogAPI({
      autologin: false,
      timeoutMs: 30,
    })

    await expect(api.auth(LOGIN, PASSWORD)).rejects.toThrow(/таймаут 30 мс/)
    expect(api.authPromise).toBeNull()
    expect(api.token).toBe('')
  })

  it('по умолчанию ставит таймаут запроса 30 секунд', async () => {
    const scheduled: number[] = []
    const original = globalThis.setTimeout
    globalThis.setTimeout = ((
      callback: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (typeof delay === 'number') scheduled.push(delay)
      return original(callback as () => void, delay, ...args)
    }) as typeof setTimeout
    try {
      const api = new NalogAPI({ autologin: false })
      await api.auth(LOGIN, PASSWORD)
      expect(scheduled).toContain(30_000)
      expect(requests[0]?.signal).toBeInstanceOf(AbortSignal)
    } finally {
      globalThis.setTimeout = original
    }
  })

  it('повторный вызов не отправляет второй запрос', async () => {
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    const again = await api.auth(LOGIN, PASSWORD)

    expect(requests.length).toBe(1)
    expect(again.refreshToken).toBe('refresh-token')
  })

  it('после ошибки логина повторный auth делает новый запрос', async () => {
    let attempts = 0
    routes[`${API}/auth/lkfl`] = () => {
      attempts += 1
      if (attempts === 1)
        return jsonResponse({ message: 'Неверный логин или пароль' })
      return jsonResponse(authPayload())
    }
    const api = new NalogAPI({ autologin: false })

    await expect(api.auth(LOGIN, PASSWORD)).rejects.toThrow(
      /Неверный логин или пароль/,
    )
    expect(api.authPromise).toBeNull()

    const again = await api.auth(LOGIN, PASSWORD)
    expect(again.refreshToken).toBe('refresh-token')
    expect(attempts).toBe(2)
    expect(api.token).toBe('access-token')
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

  it('не обновляет токен, если метод вызван до завершения авторизации', async () => {
    let releaseAuth: (response: Response) => void = () => {}
    routes[`${API}/auth/lkfl`] = () =>
      new Promise((resolve) => {
        releaseAuth = resolve
      })
    routes[`${API}/user`] = () => jsonResponse({ id: 1 })

    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    const pending = api.userInfo()
    releaseAuth(jsonResponse(authPayload()))
    const profile = await pending

    expect(profile.id).toBe(1)
    expect(requests.some((req) => req.url === `${API}/auth/token`)).toBe(false)
    expect(requests.some((req) => req.url === `${API}/user`)).toBe(true)
  })

  it('пробрасывает ошибку обновления токена', async () => {
    routes[`${API}/auth/lkfl`] = () =>
      jsonResponse(authPayload(futureIso(30 * 1000)))
    routes[`${API}/auth/token`] = () => {
      throw new Error('сеть недоступна')
    }
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    await expect(api.getToken()).rejects.toThrow('сеть недоступна')
    expect(api.token).toBe('access-token')
    expect(api.refreshToken).toBe('refresh-token')
  })

  it('не затирает токены, если обновление вернуло ошибку', async () => {
    routes[`${API}/auth/lkfl`] = () =>
      jsonResponse(authPayload(futureIso(30 * 1000)))
    routes[`${API}/auth/token`] = () =>
      jsonResponse({ message: 'сессия истекла', token: 'чужой' }, 401)
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    await expect(api.getToken()).rejects.toThrow(/сессия истекла/)
    expect(api.token).toBe('access-token')
    expect(api.refreshToken).toBe('refresh-token')
  })

  it('не затирает токены, если в успешном ответе нет token', async () => {
    routes[`${API}/auth/lkfl`] = () =>
      jsonResponse(authPayload(futureIso(30 * 1000)))
    routes[`${API}/auth/token`] = () => jsonResponse({ message: 'пусто' })
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    await expect(api.getToken()).rejects.toThrow(/пусто/)
    expect(api.token).toBe('access-token')
    expect(api.refreshToken).toBe('refresh-token')
  })

  it('после неудачного обновления следующий getToken делает новый запрос', async () => {
    let attempts = 0
    routes[`${API}/auth/lkfl`] = () =>
      jsonResponse(authPayload(futureIso(30 * 1000)))
    routes[`${API}/auth/token`] = () => {
      attempts += 1
      if (attempts === 1) return jsonResponse({ message: 'временно' }, 503)
      return jsonResponse({
        token: 'access-token-2',
        refreshToken: 'refresh-token-2',
        tokenExpireIn: futureIso(),
      })
    }
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    await expect(api.getToken()).rejects.toThrow(/временно/)
    await expect(api.getToken()).resolves.toBe('access-token-2')
    expect(attempts).toBe(2)
    expect(api.refreshToken).toBe('refresh-token-2')
  })

  it('параллельные getToken делят один запрос обновления', async () => {
    let started = 0
    let release: (response: Response) => void = () => {}
    routes[`${API}/auth/lkfl`] = () =>
      jsonResponse(authPayload(futureIso(30 * 1000)))
    routes[`${API}/auth/token`] = () => {
      started += 1
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    const first = api.getToken()
    const second = api.getToken()
    await Promise.resolve()
    expect(started).toBe(1)

    release(
      jsonResponse({
        token: 'access-token-2',
        refreshToken: 'refresh-token-2',
        tokenExpireIn: futureIso(),
      }),
    )
    await expect(first).resolves.toBe('access-token-2')
    await expect(second).resolves.toBe('access-token-2')
    expect(
      requests.filter((req) => req.url === `${API}/auth/token`),
    ).toHaveLength(1)
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
    expect(req?.signal).toBeInstanceOf(AbortSignal)
  })

  it('возвращает JSON тела при ошибочном статусе', async () => {
    routes[`${API}/user`] = () => jsonResponse({ message: 'не найдено' }, 404)
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    await expect(api.userInfo()).resolves.toEqual({ message: 'не найдено' })
  })

  it('отклоняет промис, если тело ответа не JSON', async () => {
    routes[`${API}/user`] = () =>
      new Response('<html>bad</html>', { status: 502 })
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    await expect(api.userInfo()).rejects.toThrow(SyntaxError)
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

  it('возвращает error, если регистрация дохода ответила HTTP-ошибкой', async () => {
    routes[`${API}/income`] = () => jsonResponse({ message: 'отказ' }, 400)
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    const result = await api.addIncome({ name: 'Услуга', amount: 10 })

    expect(result).toEqual({ error: { message: 'отказ' } })
    expect(requests.some((req) => req.url.includes('/receipt/'))).toBe(false)
  })

  it('округляет цену и итог одним правилом', async () => {
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    await api.addIncome({ name: 'Услуга', amount: 1.005, quantity: 2 })

    const income = requests.find((req) => req.url === `${API}/income`)
    expect(income?.body).toMatchObject({
      services: [{ name: 'Услуга', amount: 1, quantity: 2 }],
      totalAmount: '2.00',
    })
  })

  it('не ходит в сеть, если сумма не число', async () => {
    const api = new NalogAPI({ autologin: false })

    await expect(
      api.addIncome({ name: 'Услуга', amount: Number.NaN }),
    ).rejects.toThrow(TypeError)
    expect(requests).toHaveLength(0)
  })

  it('возвращает чек без data, если JSON чека не загрузился', async () => {
    routes[receiptUrl] = () => jsonResponse({ message: 'нет' }, 500)
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    const receipt = await api.addIncome({ name: 'Услуга', amount: 10 })

    expect(receipt).toEqual({
      id: 'receipt-uuid-1',
      approvedReceiptUuid: 'receipt-uuid-1',
      jsonUrl: receiptUrl,
      printUrl: `${API}/receipt/${LOGIN}/receipt-uuid-1/print`,
      data: undefined,
    })
  })

  it('возвращает чек без data, если запрос JSON чека оборвался', async () => {
    routes[receiptUrl] = () => {
      throw new Error('сеть чека')
    }
    const api = new NalogAPI({ login: LOGIN, password: PASSWORD })
    await api.authPromise

    const receipt = await api.addIncome({ name: 'Услуга', amount: 10 })

    expect(receipt).toMatchObject({
      id: 'receipt-uuid-1',
      data: undefined,
    })
    expect(receipt).not.toHaveProperty('error')
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
  const originalOffset = Date.prototype.getTimezoneOffset

  afterEach(() => {
    Date.prototype.getTimezoneOffset = originalOffset
  })

  it('возвращает локальную дату со смещением', () => {
    const api = new NalogAPI({ autologin: false })
    const formatted = api.dateToLocalISO(new Date('2024-01-02T03:04:05Z'))
    expect(formatted).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    )
  })

  it('не округляет получасовое положительное смещение', () => {
    Date.prototype.getTimezoneOffset = () => -330
    const api = new NalogAPI({ autologin: false })
    expect(api.dateToLocalISO(new Date('2024-01-02T03:04:05.000Z'))).toBe(
      '2024-01-02T08:34:05+05:30',
    )
  })

  it('не округляет получасовое отрицательное смещение', () => {
    Date.prototype.getTimezoneOffset = () => 210
    const api = new NalogAPI({ autologin: false })
    expect(api.dateToLocalISO(new Date('2024-01-02T03:04:05.000Z'))).toBe(
      '2024-01-01T23:34:05-03:30',
    )
  })

  it('оставляет целое смещение часа как есть', () => {
    Date.prototype.getTimezoneOffset = () => -180
    const api = new NalogAPI({ autologin: false })
    expect(api.dateToLocalISO(new Date('2024-01-02T03:04:05.000Z'))).toBe(
      '2024-01-02T06:04:05+03:00',
    )
  })

  it('отклоняет некорректную дату', () => {
    const api = new NalogAPI({ autologin: false })
    expect(() => api.dateToLocalISO('не дата')).toThrow(TypeError)
  })
})
