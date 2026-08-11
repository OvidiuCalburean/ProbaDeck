export const routingFunctionCode = `
function handler(event) {
  var request = event.request;
  var host = request.headers.host && request.headers.host.value;

  if (host === "www.probadeck.com") {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: {
        location: { value: "https://probadeck.com" + request.uri }
      }
    };
  }

  if (request.uri === "/") {
    request.uri = "/index.html";
  } else if (request.uri.endsWith("/")) {
    request.uri += "index.html";
  } else {
    var finalSegment = request.uri.substring(request.uri.lastIndexOf("/") + 1);
    if (finalSegment.indexOf(".") === -1) {
      request.uri += "/index.html";
    }
  }

  return request;
}
`;
