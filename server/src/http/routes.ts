export function isAgentApiRoute(pathname: string) {
  return (
    pathname === "/events" ||
    pathname === "/session" ||
    pathname.startsWith("/session/") ||
    pathname === "/permission" ||
    pathname.startsWith("/permission/") ||
    pathname === "/question" ||
    pathname.startsWith("/question/") ||
    pathname === "/self-awake/runs" ||
    pathname === "/memos" ||
    pathname.startsWith("/memos/") ||
    pathname === "/internal/self-awake/run" ||
    pathname === "/tools/status"
  )
}
