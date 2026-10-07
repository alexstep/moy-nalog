/**
 * Обёртка над API lknpd.nalog.ru («Мой налог»).
 * Подключение: `import NalogAPI = require('moy-nalog')` или `const NalogAPI = require('moy-nalog')`.
 */
declare class NalogAPI {
  /**
   * @param options.autologin при true (по умолчанию) сразу вызывает auth и требует login и password
   */
  constructor (options: NalogAPI.Options)

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

  /** Случайный идентификатор устройства для deviceInfo */
  createDeviceId (): string

  /**
   * POST /auth/lkfl. Сохраняет token, refreshToken, tokenExpireIn и INN.
   * Без refreshToken в ответе промис отклоняется.
   */
  auth (login: string, password: string): Promise<NalogAPI.AuthResponse>

  /**
   * Возвращает действующий access-токен.
   * Если до истечения меньше минуты, обновляет его через POST /auth/token.
   */
  getToken (): Promise<string>

  /**
   * Вызов метода API. Если передан payload, метод принудительно становится POST.
   * Для GET тело не отправляется. В заголовок кладётся Bearer-токен.
   */
  call (endpoint: string, payload?: Record<string, unknown> | null, method?: string): Promise<any>

  /**
   * POST /income и затем GET JSON чека.
   * При отсутствии approvedReceiptUuid возвращает `{ error }`, а не бросает исключение.
   */
  addIncome (params: NalogAPI.AddIncomeParams): Promise<NalogAPI.AddIncomeResult>

  /** GET /user */
  userInfo (): Promise<any>

  /** Дата в локальном ISO с числовым смещением, как ждёт API */
  dateToLocalISO (date?: Date | string): string
}

declare namespace NalogAPI {
  interface Options {
    login?: string
    password?: string
    autologin?: boolean
  }

  interface AuthProfile {
    inn: string
    [key: string]: unknown
  }

  interface AuthResponse {
    token: string
    refreshToken: string
    tokenExpireIn: string
    profile: AuthProfile
    message?: string
    [key: string]: unknown
  }

  interface AddIncomeParams {
    /** Название товара или услуги */
    name: string
    /** Цена одной единицы */
    amount: number
    /** Количество, по умолчанию 1 */
    quantity?: number
    /** Время поступления денег, по умолчанию сейчас */
    date?: Date | string
  }

  interface IncomeReceipt {
    id: string
    approvedReceiptUuid: string
    jsonUrl: string
    printUrl: string
    data: unknown
  }

  interface IncomeError {
    error: unknown
  }

  type AddIncomeResult = IncomeReceipt | IncomeError
}

export = NalogAPI
