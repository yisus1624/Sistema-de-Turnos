'use client'

import { sileo } from 'sileo'

export const toast = {
  success(title: string, description?: string) {
    return sileo.success({ title, description, duration: 3200 })
  },
  error(title: string, description?: string) {
    return sileo.error({ title, description, duration: 4200 })
  },
  info(title: string, description?: string) {
    return sileo.info({ title, description, duration: 3600 })
  },
  warning(title: string, description?: string) {
    return sileo.warning({ title, description, duration: 4200 })
  },
}
