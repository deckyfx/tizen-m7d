/** Browser and OS from a user agent ("Chrome on Windows"); for naming and listing devices. */
export function describeUserAgent(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /SamsungBrowser\//.test(userAgent)
          ? "Samsung Internet"
          : /Chrome\//.test(userAgent)
            ? "Chrome"
            : /Safari\//.test(userAgent)
              ? "Safari"
              : "Browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iPod/.test(userAgent)
        ? "iOS"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Tizen|SMART-TV/.test(userAgent)
            ? "TV"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "";
  return os ? `${browser} on ${os}` : browser;
}
