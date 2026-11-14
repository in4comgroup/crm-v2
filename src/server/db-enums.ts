import "server-only"

import {
  dealContactRole,
  dealStatus,
  orderRequestItemStatus,
  orderStatus,
  sourceProvider,
} from "@/db/schema"

// Value lists of DB enums, for input validation in API routes. Routes must
// not import values from @/db/* (lint rule "DB access only in src/server"),
// so they read the lists from here. Types stay `import type` from
// @/db/schema.
export const SOURCE_PROVIDERS = sourceProvider.enumValues
export const DEAL_STATUSES = dealStatus.enumValues
export const DEAL_CONTACT_ROLES = dealContactRole.enumValues
export const ORDER_STATUSES = orderStatus.enumValues
export const ORDER_REQUEST_ITEM_STATUSES = orderRequestItemStatus.enumValues
