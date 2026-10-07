const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.192 Safari/537.36'

/**
 * Обёртка над API lknpd.nalog.ru («Мой налог»).
 * Подключение: `import NalogAPI from 'moy-nalog'` или `const NalogAPI = require('moy-nalog')`.
 */
class NalogAPI {
  /** Базовый URL, по умолчанию https://lknpd.nalog.ru/api/v1 */
  apiUrl: string

  /** Идентификатор устройства, с которым связана сессия */
  sourceDeviceId: string

  /** Промис текущей авторизации. Повторный auth возвращает тот же промис. */
  authPromise: Promise<NalogAPI.AuthResponse> | null

  /** ИНН из profile после успешной авторизации */
  INN: string

  /** Access-токен */
  token: string

  /** Срок действия access-токена в виде строки даты */
  tokenExpireIn: string

  /** Refresh-токен */
  refreshToken: string

  /**
   * @param options.autologin при true (по умолчанию) сразу вызывает auth и требует login и password
   */
  constructor(options: NalogAPI.Options) {
    const autologin = options.autologin ?? true
    const login = options.login
    const password = options.password
    if (autologin && (!login || !password)) {
      throw new SyntaxError('NalogAPI required login+password for auth')
    }

    this.apiUrl = 'https://lknpd.nalog.ru/api/v1'
    this.sourceDeviceId = this.createDeviceId()
    this.authPromise = null
    this.INN = ''
    this.token = ''
    this.tokenExpireIn = ''
    this.refreshToken = ''

    if (autologin) {
      this.auth(login as string, password as string)
    }
  }

  /** Случайный идентификатор устройства для deviceInfo */
  createDeviceId(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    )
  }

  /**
   * POST /auth/lkfl. Сохраняет token, refreshToken, tokenExpireIn и INN.
   * Без refreshToken в ответе промис отклоняется.
   */
  auth(login: string, password: string): Promise<NalogAPI.AuthResponse> {
    if (this.authPromise) return this.authPromise

    this.authPromise = fetch(`${this.apiUrl}/auth/lkfl`, {
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
            userAgent: USER_AGENT,
          },
        },
      }),
    }).then(async (response) => {
      const body = (await response.json()) as NalogAPI.AuthResponse
      if (!body.refreshToken) {
        throw new Error(body.message || 'Не получилось авторизоваться')
      }
      this.INN = body.profile.inn
      this.token = body.token
      this.tokenExpireIn = body.tokenExpireIn
      this.refreshToken = body.refreshToken
      return body
    })

    return this.authPromise
  }

  /**
   * Возвращает действующий access-токен.
   * Если до истечения меньше минуты, обновляет его через POST /auth/token.
   */
  async getToken(): Promise<string> {
    if (this.authPromise) await this.authPromise

    if (
      this.token &&
      this.tokenExpireIn &&
      Date.now() + 60 * 1000 < new Date(this.tokenExpireIn).getTime()
    ) {
      return this.token
    }

    if (!this.authPromise) {
      throw new Error('Необходимо сначала авторизоваться')
    }

    const tokenPayload = {
      deviceInfo: {
        appVersion: '1.0.0',
        sourceDeviceId: this.sourceDeviceId,
        sourceType: 'WEB',
        metaDetails: {
          userAgent: USER_AGENT,
        },
      },
      refreshToken: this.refreshToken,
    }

    const refresh = await fetch(`${this.apiUrl}/auth/token`, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'content-type': 'application/json',
      },
      referrer: 'https://lknpd.nalog.ru/sales',
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: JSON.stringify(tokenPayload),
    })
    const response = (await refresh.json()) as NalogAPI.TokenResponse

    if (response.refreshToken) this.refreshToken = response.refreshToken

    this.token = response.token
    this.tokenExpireIn = response.tokenExpireIn

    return this.token
  }

  /**
   * Вызов метода API. Если передан payload, метод принудительно становится POST.
   * Для GET тело не отправляется. В заголовок кладётся Bearer-токен.
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
        authorization: `Bearer ${await this.getToken()}`,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'content-type': 'application/json',
      },
      referrer: 'https://lknpd.nalog.ru/sales/create',
      referrerPolicy: 'strict-origin-when-cross-origin',
      body: JSON.stringify(payload),
    }

    if (method === 'GET') delete params.body

    return fetch(`${this.apiUrl}/${endpoint}`, params).then((response) =>
      response.json(),
    )
  }

  /**
   * POST /income и затем GET JSON чека.
   * При отсутствии approvedReceiptUuid возвращает `{ error }`, а не бросает исключение.
   */
  async addIncome({
    date = new Date(),
    name,
    quantity = 1,
    amount,
  }: NalogAPI.AddIncomeParams): Promise<NalogAPI.AddIncomeResult> {
    const response = await this.call('income', {
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
          amount: Number(amount.toFixed(2)),
          quantity: Number(quantity),
        },
      ],
      totalAmount: (amount * quantity).toFixed(2),
    })

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
    result.data = await fetch(result.jsonUrl).then((receipt) => receipt.json())

    return result
  }

  /** GET /user */
  async userInfo(): Promise<any> {
    return this.call('user')
  }

  /** Дата в локальном ISO с числовым смещением, как ждёт API */
  dateToLocalISO(date: Date | string = new Date()): string {
    const value = new Date(date)
    const off = value.getTimezoneOffset()
    const absoff = Math.abs(off)
    return (
      new Date(value.getTime() - off * 60 * 1000).toISOString().slice(0, 19) +
      (off > 0 ? '-' : '+') +
      (absoff / 60).toFixed(0).padStart(2, '0') +
      ':' +
      (absoff % 60).toString().padStart(2, '0')
    )
  }
}

namespace NalogAPI {
  export interface Options {
    login?: string
    password?: string
    autologin?: boolean
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
