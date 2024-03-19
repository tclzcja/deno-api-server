export class CustomError extends Error {
    #httpStatusCode;
    get httpStatusCode() {
        return this.#httpStatusCode;
    }
    constructor(message, httpStatusCode = 400) {
        super(message);
        this.#httpStatusCode = httpStatusCode;
    }
}

export class Router {
    static #DEFAULT_HEADERS = {
        "Access-Control-Allow-Origin": '*',
        "Access-Control-Allow-Headers": "Origin, Referer, Content-Type, Content-SHA256, Content-Filename, Content-Duration, Accept, Authorization, User-Agent, Cache-Control, X-Api-Key",
        "Access-Control-Allow-Methods": "GET, OPTION, POST, PUT, DELETE, PATCH, TEST",
        "Access-Control-Expose-Headers": "Authorization, Content-SHA256",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "300",
    };
    static #API_PREFIX = undefined;
    static #AUTH_VERIFY = undefined;
    static #AUTH_SIGN = undefined;

    static #ROUTER_MAP = {};

    static Route(path, method, handler, { verify, sign } = {}) {
        Router.#ROUTER_MAP[path] = Router.#ROUTER_MAP[path] ?? {};
        Router.#ROUTER_MAP[path][method] = {
            handler,
            verify,
            sign
        };
    }

    static Run({
        port = 8000,
        auth_verify,
        auth_sign,
        default_headers,
        api_prefix
    } = {}
    ) {
        Router.#DEFAULT_HEADERS = default_headers ?? Router.#DEFAULT_HEADERS;
        Router.#API_PREFIX = api_prefix ?? Router.#API_PREFIX;
        Router.#AUTH_VERIFY = auth_verify ?? Router.#AUTH_VERIFY;
        Router.#AUTH_SIGN = auth_sign ?? Router.#AUTH_SIGN;

        Deno.serve({ port }, async (req) => {

            const U = Router.#API_PREFIX ? new URL(req.url.replace(Router.#API_PREFIX, "")) : new URL(req.url);

            if (req.method === "OPTIONS") {
                return new Response(null, { status: 200, headers: Router.#DEFAULT_HEADERS });
            }

            const path = "/" + U.pathname.split("/")[1];

            if (!Router.#ROUTER_MAP[path]) {
                return new Response(`Request path ${path} does not exist`, { status: 404, headers: Router.#DEFAULT_HEADERS });
            }

            if (!Router.#ROUTER_MAP[path][req.method]) {
                return new Response(`Request method ${req.method} does not exist on path ${path}`, { status: 405, headers: Router.#DEFAULT_HEADERS });
            }

            try {
                let result = null;
                let user = null;

                const responseHeaders = structuredClone(Router.#DEFAULT_HEADERS);
                const responseStatus = req.method === "POST" ? 201 : 200;

                if (Router.#ROUTER_MAP[path][req.method].verify && Router.#AUTH_VERIFY) {
                    user = await Router.#AUTH_VERIFY(req);
                }

                if (req.method === "GET") {
                    const params = new URL(req.url).searchParams;
                    result = await Router.#ROUTER_MAP[path][req.method].handler(Object.fromEntries(params), user, req);
                } else {
                    switch (req.headers.get("content-type")) {
                        case "application/json": {
                            let body;
                            try {
                                body = await req.json();
                            } catch {
                                throw new CustomError("Request body is not a valid JSON", 400);
                            }
                            result = await Router.#ROUTER_MAP[path][req.method].handler(body, user, req);
                            break;
                        }
                        case "text/plain": {
                            let text;
                            try {
                                text = await req.text();
                            } catch {
                                throw new CustomError("Request body is not a valid STRING", 400);
                            }
                            result = await Router.#ROUTER_MAP[path][req.method].handler(text, user, req);
                            break;
                        }
                        case "multipart/form-data": {
                            let formdata;
                            try {
                                formdata = await req.formData();
                            } catch {
                                throw new CustomError("Request body is not a valid FORMDATA", 400);
                            }
                            result = await Router.#ROUTER_MAP[path][req.method].handler(formdata, user, req);
                            break;
                        }
                        default: {
                            result = await Router.#ROUTER_MAP[path][req.method].handler(req, user, req);
                            break;
                        }
                    }
                }

                let response;

                switch (true) {
                    case typeof result === "bigint":
                        responseHeaders["Content-Type"] = "text/plain";
                        response = new Response(result.toString(), { status: responseStatus, headers: responseHeaders });
                        break;
                    case typeof result === "string" || result instanceof String:
                        responseHeaders["Content-Type"] = "text/plain";
                        response = new Response(result, { status: responseStatus, headers: responseHeaders });
                        break;
                    case result === null || result === undefined:
                        responseHeaders["Content-Type"] = "text/plain";
                        response = new Response(null, { status: responseStatus, headers: responseHeaders });
                        break;
                    case result instanceof Response:
                        response = result;
                        break;
                    case typeof result === "object":
                        responseHeaders["Content-Type"] = "application/json";
                        response = new Response(result ? JSON.stringify(result) : undefined, { status: responseStatus, headers: responseHeaders });
                        break;
                    case typeof result === "boolean":
                        responseHeaders["Content-Type"] = "text/plain";
                        response = new Response(result?.toString(), { status: responseStatus, headers: responseHeaders });
                        break;
                    default:
                        throw new Error("Return type of controller has no defined processor");
                }

                if (Router.#ROUTER_MAP[path][req.method].sign && Router.#AUTH_SIGN) {
                    await Router.#AUTH_SIGN(response, result);
                }

                return response;
            } catch (e) {
                if (e instanceof CustomError) {
                    return new Response(e.message, {
                        status: e.httpStatusCode,
                        headers: Object.assign(Router.#DEFAULT_HEADERS, {
                            "Content-Type": "text/plain",
                        }),
                    });
                } else {
                    console.error(e);
                    return new Response(e.message, {
                        status: 500,
                        headers: Router.#DEFAULT_HEADERS,
                    });
                }
            }
        });
    }
}