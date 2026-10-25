import { DAVClient, type DAVCalendar, type DAVCalendarObject } from 'tsdav'

export interface CalDavCredentials {
  serverUrl: string
  username: string
  password: string
}

export interface RemoteEventRef {
  calendar: DAVCalendar
  url: string
  etag: string
}

/**
 * CalDAV 客户端薄封装：只暴露 secbrain 需要的能力。
 * 凭证经构造注入，不在本类持久化。
 */
export class CalDavClient {
  private client: DAVClient | null = null

  /** 登录并返回远程日历列表；失败抛错（含 401 等） */
  async connect(credentials: CalDavCredentials): Promise<DAVCalendar[]> {
    const client = new DAVClient({
      serverUrl: credentials.serverUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav'
    })
    await client.login()
    this.client = client
    return client.fetchCalendars()
  }

  private requireClient(): DAVClient {
    if (!this.client) throw new Error('CalDAV 未连接')
    return this.client
  }

  /** 当前是否已连接（登录成功且未断开） */
  isConnected(): boolean {
    return this.client !== null
  }

  async listCalendars(): Promise<DAVCalendar[]> {
    return this.requireClient().fetchCalendars()
  }

  /** 拉取时间范围内的事件对象（含 etag） */
  async fetchEvents(calendar: DAVCalendar, range: { start: string; end: string }): Promise<DAVCalendarObject[]> {
    return this.requireClient().fetchCalendarObjects({ calendar, timeRange: range })
  }

  /** 拉取提醒列表（VTODO）对象 */
  async fetchTodos(calendar: DAVCalendar): Promise<DAVCalendarObject[]> {
    const filters = [
      {
        'comp-filter': {
          _attributes: { name: 'VCALENDAR' },
          'comp-filter': { _attributes: { name: 'VTODO' } }
        }
      }
    ]
    return this.requireClient().fetchCalendarObjects({
      calendar,
      // tsdav 的 filter 类型未覆盖 VTODO，这里按运行期结构传入
      filters: filters as unknown as undefined
    })
  }

  /** 创建远程事件，返回对象引用（含新 etag） */
  async createEvent(calendar: DAVCalendar, uid: string, iCalString: string): Promise<RemoteEventRef> {
    const client = this.requireClient()
    const filename = `${uid}.ics`
    await client.createCalendarObject({ calendar, iCalString, filename })
    const url = joinUrl(calendar.url, filename)
    const objects = await client.fetchCalendarObjects({ calendar, objectUrls: [url] })
    const etag = objects[0]?.etag ?? ''
    return { calendar, url, etag }
  }

  /** 更新远程事件（带 If-Match etag；冲突时服务端返回 412） */
  async updateEvent(ref: RemoteEventRef, iCalString: string): Promise<string> {
    const client = this.requireClient()
    await client.updateCalendarObject({
      calendarObject: { url: ref.url, etag: ref.etag, data: iCalString }
    })
    const objects = await client.fetchCalendarObjects({
      calendar: ref.calendar,
      objectUrls: [ref.url]
    })
    return objects[0]?.etag ?? ref.etag
  }

  async deleteEvent(ref: RemoteEventRef): Promise<void> {
    await this.requireClient().deleteCalendarObject({
      calendarObject: { url: ref.url, etag: ref.etag, data: '' }
    })
  }

  /** 重新拉取单个对象的最新 etag（412 冲突恢复用） */
  async refetch(calendar: DAVCalendar, url: string): Promise<RemoteEventRef | null> {
    const objects = await this.requireClient().fetchCalendarObjects({ calendar, objectUrls: [url] })
    const first = objects[0]
    if (!first) return null
    return { calendar, url, etag: first.etag ?? '' }
  }

  disconnect(): void {
    this.client = null
  }
}

function joinUrl(base: string, filename: string): string {
  return base.endsWith('/') ? `${base}${filename}` : `${base}/${filename}`
}
