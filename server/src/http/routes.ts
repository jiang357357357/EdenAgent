export function isAgentApiRoute(pathname: string) {
  return (
    pathname === "/global/event" ||
    pathname === "/session" ||
    pathname.startsWith("/session/") ||
    pathname === "/permission" ||
    pathname.startsWith("/permission/") ||
    pathname === "/question" ||
    pathname.startsWith("/question/") ||
    pathname === "/internal/self-awake/run" ||
    pathname === "/tools/status"
  )
}
