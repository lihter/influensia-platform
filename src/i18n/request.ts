import { getRequestConfig } from "next-intl/server";

// Single locale in v1 (D-20). No routing, no cookies: the locale is a constant.
export default getRequestConfig(async () => ({
  locale: "en",
  messages: (await import("../../messages/en.json")).default,
}));
