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
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Credentials": "true",
    };
    static #API_PREFIX = undefined;

    static #ROUTER_MAP = {};

    static Route(path, method, handler, { verify, sign, login, raw } = {}) {

        if (verify && typeof verify !== 'function') {
            throw new Error(`The "verify" option must be a function`);
        }

        if (sign && typeof sign !== 'function') {
            throw new Error(`The "sign" option must be a function`);
        }

        if (login && typeof login !== 'function') {
            throw new Error(`The "login" option must be a function`);
        }

        Router.#ROUTER_MAP[path] = Router.#ROUTER_MAP[path] ?? {};
        Router.#ROUTER_MAP[path][method] = {
            handler,
            verify,
            sign,
            login,
            raw
        };
    }

    static Run({
        port = 8000,
        default_headers,
        api_prefix
    } = {}
    ) {
        Router.#DEFAULT_HEADERS = default_headers ?? Router.#DEFAULT_HEADERS;
        Router.#API_PREFIX = api_prefix ?? Router.#API_PREFIX;

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
                let payload = null;

                const responseHeaders = structuredClone(Router.#DEFAULT_HEADERS);
                const responseStatus = req.method === "POST" ? 201 : 200;

                if (Router.#ROUTER_MAP[path][req.method].verify) {
                    payload = await Router.#ROUTER_MAP[path][req.method].verify(req);
                }

                if (req.method === "GET") {
                    const params = new URL(req.url).searchParams;
                    result = await Router.#ROUTER_MAP[path][req.method].handler(Object.fromEntries(params), { payload, req });
                } else {
                    switch (req.headers.get("content-type")) {
                        case "application/json": {
                            let body;
                            try {
                                body = await req.json();
                            } catch {
                                throw new CustomError("Request body is not a valid JSON", 400);
                            }
                            result = await Router.#ROUTER_MAP[path][req.method].handler(body, { payload, req });
                            break;
                        }
                        case "text/plain": {
                            let text;
                            try {
                                text = await req.text();
                            } catch {
                                throw new CustomError("Request body is not a valid STRING", 400);
                            }
                            result = await Router.#ROUTER_MAP[path][req.method].handler(text, { payload, req });
                            break;
                        }
                        case "multipart/form-data": {
                            let formdata;
                            try {
                                formdata = await req.formData();
                            } catch {
                                throw new CustomError("Request body is not a valid FORMDATA", 400);
                            }
                            result = await Router.#ROUTER_MAP[path][req.method].handler(formdata, { payload, req });
                            break;
                        }
                        default: {
                            result = await Router.#ROUTER_MAP[path][req.method].handler(req, { payload, req });
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

                if (Router.#ROUTER_MAP[path][req.method].sign) {
                    await Router.#ROUTER_MAP[path][req.method].sign(response, payload);
                }

                if (Router.#ROUTER_MAP[path][req.method].login) {
                    await Router.#ROUTER_MAP[path][req.method].login(response, result);
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