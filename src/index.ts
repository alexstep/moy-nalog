const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.192 Safari/537.36'

const REQUEST_TIMEOUT_MS = 30_000

const JSON_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'content-type': 'application/json',
}

const INSPECT_CUSTOM = Symbol.for('nodejs.util.inspect.custom')

interface RequestError extends Error {
  status: number
  body: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isRequestError(error: unknown): error is RequestError {
  return (
    error instanceof Error && typeof (error as RequestError).status === 'number'
  )
}

function requestFailed(
  status: number,
  body: unknown,
  fallback: string,
): RequestError {
  const fromBody =
    isRecord(body) && typeof body.message === 'string' && body.message
      ? body.message
      : null
  const message = fromBody ?? `${fallback} (${status})`
  const error = new Error(message) as RequestError
  error.status = status
  error.body = body
  return error
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function deviceInfo(sourceDeviceId: string) {
  return {
    sourceDeviceId,
    sourceType: 'WEB',
    appVersion: '1.0.0',
    metaDetails: {
      userAgent: USER_AGENT,
    },
  }
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2))
}

function isAuthResponse(body: unknown): body is NalogAPI.AuthResponse {
  if (!isRecord(body)) return false
  const profile = body.profile
  return (
    typeof body.token === 'string' &&
    body.token.length > 0 &&
    typeof body.refreshToken === 'string' &&
    body.refreshToken.length > 0 &&
    typeof body.tokenExpireIn === 'string' &&
    body.tokenExpireIn.length > 0 &&
    isRecord(profile) &&
    typeof profile.inn === 'string' &&
    profile.inn.length > 0
  )
}

function isTokenResponse(body: unknown): body is NalogAPI.TokenResponse {
  if (!isRecord(body)) return false
  return (
    typeof body.token === 'string' &&
    body.token.length > 0 &&
    typeof body.tokenExpireIn === 'string' &&
    body.tokenExpireIn.length > 0 &&
    (body.refreshToken === undefined || typeof body.refreshToken === 'string')
  )
}

/**
 * Обёртка над API lknpd.nalog.ru («Мой налог»).
 * Подключение: `import NalogAPI from 'moy-nalog'` или `const NalogAPI = require('moy-nalog')`.
 */
class NalogAPI {
  /** Базовый URL, по умолчанию https://lknpd.nalog.ru/api/v1 */
  apiUrl: string

  /** Идентификатор устройства, с которым связана сессия */
  sourceDeviceId: string

  /** Промис текущей авторизации. Пока он не отклонён, повторный auth возвращает его же. */
  authPromise: Promise<NalogAPI.AuthResponse> | null

  /** ИНН из profile после успешной авторизации */
  INN: string

  /** Access-токен. Свойство доступно напрямую и не попадает в JSON.stringify. */
  token: string

  /** Срок действия access-токена в виде строки даты */
  tokenExpireIn: string

  /** Refresh-токен. Свойство доступно напрямую и не попадает в JSON.stringify. */
  refreshToken: string

  #timeoutMs: number

  #refreshing: Promise<string> | null = null

  /**
   * @param options.autologin при true (по умолчанию) сразу вызывает auth и требует login и password
   * @param options.timeoutMs таймаут одного HTTP-запроса в миллисекундах, по умолчанию 30000
   */
  constructor(options: NalogAPI.Options) {
    const autologin = options.autologin ?? true
    const login = options.login
    const password = options.password
    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
    if (autologin && (!login || !password)) {
      throw new SyntaxError(
        'NalogAPI: для входа нужны login и password (autologin включён)',
      )
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('timeoutMs должен быть положительным числом')
    }

    this.apiUrl = 'https://lknpd.nalog.ru/api/v1'
    this.sourceDeviceId = this.createDeviceId()
    this.authPromise = null
    this.INN = ''
    this.token = ''
    this.tokenExpireIn = ''
    this.refreshToken = ''
    this.#timeoutMs = timeoutMs

    if (autologin) {
      // Пустой обработчик гасит unhandledRejection, если вызывающий код ещё не ждёт промис.
      // Сам authPromise при этом по-прежнему отклоняется.
      void this.auth(login as string, password as string).catch(() => undefined)
    }
  }

  /** Снимок без секретов для JSON.stringify и util.inspect. */
  toJSON(): NalogAPI.PublicState {
    return {
      apiUrl: this.apiUrl,
      sourceDeviceId: this.sourceDeviceId,
      INN: this.INN,
      tokenExpireIn: this.tokenExpireIn,
    }
  }

  [INSPECT_CUSTOM](): NalogAPI.PublicState {
    return this.toJSON()
  }

  /** UUID устройства для deviceInfo */
  createDeviceId(): string {
    return crypto.randomUUID()
  }

  /**
   * POST /auth/lkfl. Сохраняет token, refreshToken, tokenExpireIn и INN.
   * Без успешного статуса и refreshToken промис отклоняется, поля сессии не меняются.
   */
  auth(login: string, password: string): Promise<NalogAPI.AuthResponse> {
    if (this.authPromise) return this.authPromise

    this.authPromise = this.#login(login, password).catch((error: unknown) => {
      this.authPromise = null
      throw error
    })

    return this.authPromise
  }

  /**
   * Возвращает действующий access-токен.
   * Если до истечения меньше минуты, один раз обновляет его через POST /auth/token.
   * Параллельные вызовы ждут тот же запрос. Неуспешный ответ не затирает текущие токены.
   */
  async getToken(): Promise<string> {
    if (this.authPromise) await this.authPromise

    if (this.#tokenIsFresh()) return this.token

    if (!this.refreshToken) {
      throw new Error('Необходимо сначала авторизоваться')
    }

    if (!this.#refreshing) {
      const pending = this.#refreshAccessToken().finally(() => {
        if (this.#refreshing === pending) this.#refreshing = null
      })
      this.#refreshing = pending
    }

    return this.#refreshing
  }

  /**
   * Вызов метода API. Если передан payload, метод принудительно становится POST.
   * Для GET тело не отправляется. В заголовок кладётся Bearer-токен.
   * Ответ со статусом не 2xx отклоняет промис. У объекта ошибки есть status и body.
   */
  async call(
    endpoint: string,
    payload?: Record<string, unknown> | null,
    method = 'GET',
  ): Promise<any> {
    if (payload) method = 'POST'

    const params: RequestInit = {
      method: method,
      headers: {
        ...JSON_HEADERS,
        authorization: `Bearer ${await this.getToken()}`,
      },
      referrer: 'https://lknpd.nalog.ru/sales/create',
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: JSON.stringify(payload),
    }

    if (method === 'GET') delete params.body

    const response = await this.#fetch(`${this.apiUrl}/${endpoint}`, params)
    const body = await readBody(response)
    if (!response.ok) {
      throw requestFailed(response.status, body, 'Запрос завершился ошибкой')
    }
    return body
  }

  /**
   * POST /income и затем GET JSON чека.
   * При отсутствии approvedReceiptUuid или при HTTP-ошибке регистрации возвращает `{ error }`.
   * Если чек уже создан, сбой загрузки JSON не отклоняет промис: data остаётся undefined.
   */
  async addIncome({
    date = new Date(),
    name,
    quantity = 1,
    amount,
  }: NalogAPI.AddIncomeParams): Promise<NalogAPI.AddIncomeResult> {
    const count = Number(quantity)
    if (!Number.isFinite(amount) || !Number.isFinite(count)) {
      throw new TypeError('amount и quantity должны быть конечными числами')
    }
    const unit = roundMoney(amount)
    const total = roundMoney(unit * count)

    let response: any
    try {
      response = await this.call('income', {
        paymentType: 'CASH',
        ignoreMaxTotalIncomeRestriction: false,
        client: {
          contactPhone: null,
          displayName: null,
          incomeType: 'FROM_INDIVIDUAL',
          inn: null,
        },
        requestTime: this.dateToLocalISO(),
        operationTime: this.dateToLocalISO(date),
        services: [
          {
            name: name,
            amount: unit,
            quantity: count,
          },
        ],
        totalAmount: total.toFixed(2),
      })
    } catch (error) {
      if (isRequestError(error)) return { error: error.body }
      throw error
    }

    if (!response?.approvedReceiptUuid) {
      return { error: response }
    }

    const result: NalogAPI.IncomeReceipt = {
      id: response.approvedReceiptUuid,
      approvedReceiptUuid: response.approvedReceiptUuid,
      jsonUrl: `${this.apiUrl}/receipt/${this.INN}/${response.approvedReceiptUuid}/json`,
      printUrl: `${this.apiUrl}/receipt/${this.INN}/${response.approvedReceiptUuid}/print`,
      data: undefined,
    }

    try {
      const receipt = await this.#fetch(result.jsonUrl, { method: 'GET' })
      if (receipt.ok) result.data = await readBody(receipt)
    } catch {
      // Чек уже зарегистрирован. Повтор addIncome создал бы второй.
    }

    return result
  }

  /** GET /user */
  async userInfo(): Promise<any> {
    return this.call('user')
  }

  /** Дата в локальном ISO с числовым смещением, как ждёт API */
  dateToLocalISO(date: Date | string = new Date()): string {
    const value = new Date(date)
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('Некорректная дата')
    }
    const off = value.getTimezoneOffset()
    const abs = Math.abs(off)
    const hours = Math.floor(abs / 60)
    const minutes = abs % 60
    const local = new Date(value.getTime() - off * 60 * 1000)
      .toISOString()
      .slice(0, 19)
    const sign = off > 0 ? '-' : '+'
    return `${local}${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }

  #tokenIsFresh(): boolean {
    return Boolean(
      this.token &&
        this.tokenExpireIn &&
        Date.now() + 60 * 1000 < new Date(this.tokenExpireIn).getTime(),
    )
  }

  async #login(
    login: string,
    password: string,
  ): Promise<NalogAPI.AuthResponse> {
    const response = await this.#fetch(`${this.apiUrl}/auth/lkfl`, {
      method: 'POST',
      headers: JSON_HEADERS,
      referrer: 'https://lknpd.nalog.ru/',
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: JSON.stringify({
        username: login,
        password,
        deviceInfo: deviceInfo(this.sourceDeviceId),
      }),
    })
    const body = await readBody(response)
    if (!response.ok || !isAuthResponse(body)) {
      throw requestFailed(response.status, body, 'Не получилось авторизоваться')
    }
    this.INN = body.profile.inn
    this.token = body.token
    this.tokenExpireIn = body.tokenExpireIn
    this.refreshToken = body.refreshToken
    return body
  }

  async #refreshAccessToken(): Promise<string> {
    const response = await this.#fetch(`${this.apiUrl}/auth/token`, {
      method: 'POST',
      headers: JSON_HEADERS,
      referrer: 'https://lknpd.nalog.ru/sales',
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: JSON.stringify({
        deviceInfo: deviceInfo(this.sourceDeviceId),
        refreshToken: this.refreshToken,
      }),
    })
    const body = await readBody(response)
    if (!response.ok || !isTokenResponse(body)) {
      throw requestFailed(response.status, body, 'Не получилось обновить токен')
    }
    if (body.refreshToken) this.refreshToken = body.refreshToken
    this.token = body.token
    this.tokenExpireIn = body.tokenExpireIn
    return this.token
  }

  async #fetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException(
            `Превышен таймаут ${this.#timeoutMs} мс`,
            'TimeoutError',
          ),
        ),
      this.#timeoutMs,
    )
    if (typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref()
    }
    try {
      return await fetch(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }
}

namespace NalogAPI {
  export interface Options {
    login?: string
    password?: string
    autologin?: boolean
    /** Таймаут одного HTTP-запроса в миллисекундах. По умолчанию 30000. */
    timeoutMs?: number
  }

  /** Поля экземпляра, которые безопасно попадают в JSON.stringify. */
  export interface PublicState {
    apiUrl: string
    sourceDeviceId: string
    INN: string
    tokenExpireIn: string
  }

  export interface AuthProfile {
    inn: string
    [key: string]: unknown
  }

  export interface AuthResponse {
    token: string
    refreshToken: string
    tokenExpireIn: string
    profile: AuthProfile
    message?: string
    [key: string]: unknown
  }

  export interface TokenResponse {
    token: string
    tokenExpireIn: string
    refreshToken?: string
  }

  export interface AddIncomeParams {
    /** Название товара или услуги */
    name: string
    /** Цена одной единицы */
    amount: number
    /** Количество, по умолчанию 1 */
    quantity?: number
    /** Время поступления денег, по умолчанию сейчас */
    date?: Date | string
  }

  export interface IncomeReceipt {
    id: string
    approvedReceiptUuid: string
    jsonUrl: string
    printUrl: string
    data: unknown
  }

  export interface IncomeError {
    error: unknown
  }

  export type AddIncomeResult = IncomeReceipt | IncomeError
}

export default NalogAPI
