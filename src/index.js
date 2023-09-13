(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(["@cocreate/crud-client", "@cocreate/utils"], function (crud, { getValueFromObject, dotNotationToObject }) {
            return factory(true, crud, { getValueFromObject, dotNotationToObject })
        });
    } else if (typeof module === 'object' && module.exports) {
        const { getValueFromObject, dotNotationToObject } = require("@cocreate/utils");
        module.exports = class CoCreateAuthorize {
            constructor(crud) {
                return factory(false, crud, { getValueFromObject, dotNotationToObject });
            }
        }
    } else {
        root.returnExports = factory(true, root["@cocreate/crud-client"], root["@cocreate/utils"]);
    }
}(typeof self !== 'undefined' ? self : this, function (isBrowser, crud, { getValueFromObject, dotNotationToObject }) {

    const authorizations = new Map()

    if (isBrowser) {
        crud.listen('update.object', function (data) {
            updateAuthorization(data)
        });

        crud.listen('delete.object', function (data) {
            deleteAuthorization(data)
        });
    } else {
        process.on('changed-object', async (data) => {
            updateAuthorization(data)
        })
    }

    async function updateAuthorization(data) {
        const { array, object, organization_id } = data

        if (array === 'keys' && object) {
            let authorization = object[0]
            if (authorization && authorization.key && hasAuthorization(authorization.key)) {
                let newAuthorization = await readAuthorization(authorization.key, organization_id)
                setAuthorization(authorization.key, newAuthorization)
            }
        }
    }

    async function deleteAuthorization(data) {
        const { array, object, organization_id } = data

        if (array === 'keys' && object) {
            let authorization = object[0]
            if (authorization && authorization.key && hasAuthorization(authorization.key)) {
                authorizations.delete(authorization.key)
            }
        }
    }

    function setAuthorization(key, authorization) {
        authorizations.set(key, authorization)
    }

    function hasAuthorization(key) {
        return authorizations.has(key)
    }

    async function getAuthorization(key, organization_id) {
        if (authorizations.get(key)) {
            return authorizations.get(key)
        } else {
            let authorization = await readAuthorization(key, organization_id);
            authorizations.set(key, authorization)
            return authorization
        }
    }

    async function readAuthorization(key, organization_id) {
        try {
            if (!organization_id)
                return null;

            let request = {
                method: 'read.object',
                array: 'keys',
                organization_id,
                object: {
                    $filter: {
                        query: []
                    }
                }
            }

            if (key)
                request.object.$filter.query.push({ key: 'key', value: key, operator: '$eq' })
            else
                request.object.$filter.query.push({ key: 'default', value: true, operator: '$eq' })


            let authorization = await crud.send(request)
            if (authorization && authorization.object && authorization.object[0]) {
                authorization = authorization.object[0]

                if (!authorization.arrays) {
                    authorization.arrays = {};
                }

                if (authorization && authorization.roles) {
                    const role_ids = []
                    authorization.roles.forEach((_id) => {
                        if (_id)
                            role_ids.push({ _id })
                    })

                    delete request.object.$filter
                    delete request.request
                    request.object = role_ids

                    let roles = await crud.send(request)
                    roles = roles.object

                    authorization = createAuthorization(authorization, roles)
                }

            }

            return authorization;

        } catch (error) {
            console.log("authorization Error", error)
            return null;
        }

    }

    async function createAuthorization(authorization, roles) {
        roles.map(role => {
            for (const roleKey in role) {
                if (!["_id", "type", "name", "organization_id"].includes(roleKey)) {
                    if (!authorization[roleKey]) {
                        authorization[roleKey] = role[roleKey]
                    } else {
                        if (Array.isArray(role[roleKey])) {
                            for (let item of role[roleKey]) {
                                if (!authorization[roleKey].includes(item))
                                    authorization[roleKey].push(item)
                            }
                        }
                        else if (typeof role[roleKey] == 'object') {
                            for (const c of Object.keys(role[roleKey])) {
                                if (!authorization[roleKey][c]) {
                                    authorization[roleKey][c] = role[roleKey][c]
                                } else {
                                    if (typeof role[roleKey][c] == 'object') {
                                        authorization[roleKey][c] = { ...authorization[roleKey][c], ...role[roleKey][c] }
                                    } else {
                                        authorization[roleKey][c] = role[roleKey][c]
                                    }
                                }
                            }
                        } else {
                            authorization[roleKey] = role[roleKey]
                        }
                    }
                }
            }
        })
        return authorization;
    }

    async function check(data, user_id) {
        let authorization = false
        if (user_id) {
            authorization = await checkAuthorization({
                key: user_id,
                data
            })
        }
        if (!authorization || authorization.error) {
            authorization = await checkAuthorization({
                key: data.apikey,
                data
            })
        }
        return authorization;
    }

    async function checkAuthorization({ key, data }) {
        // let method = data.method
        let { method, organization_id, endPoint } = data
        if (!key || !organization_id) return false;

        let autorized = await getAuthorization(key, organization_id)
        if (!autorized || autorized.error)
            return autorized
        if (autorized.organization_id !== organization_id)
            return false;
        if (autorized.host && autorized.host.length) {
            if (!autorized.host || (!autorized.host.includes(data.host) && !autorized.host.includes("*")))
                return false;

        }
        if (autorized.admin == 'true' || autorized.admin === true)
            return true;

        let status = await checkMethod(autorized.actions, method, endPoint, data)

        if (!status)
            return false

        return { authorized: data };
    }

    async function checkMethod(autorized, method, endPoint, data) {
        if (!autorized || !method || !autorized[method] || autorized[method] == 'false') return false;
        if (autorized[method] === true || autorized[method] == 'true' || autorized[method] == '*') return true;

        let authorized = autorized[method].authorize
        if (authorized) {
            let status = await checkAthorized(authorized, method, endPoint, data)
            if (!status)
                return false
            else {
                let unauthorized = autorized[method].unauthorize
                if (unauthorized) {
                    let status = await checkAthorized(unauthorized, method, endPoint, data, true)
                    if (status)
                        return false
                }
                return true
            }
        } else
            return false
    }

    async function checkAthorized(authorized, method, endPoint, data, unauthorize) {
        if (!Array.isArray(authorized))
            authorized = [authorized]

        let status = false
        for (let i = 0; i < authorized.length; i++) {
            // if authorized[i] is a booleaan
            if (authorized[i] === true)
                return true

            // if authorized[i] is a string or an array
            if (typeof authorized[i] === "string" || Array.isArray(authorized[i])) {
                if (authorized[i].includes(true) || authorized[i].includes('true') || authorized[i].includes('*'))
                    return true
                else if (endPoint)
                    return authorized.includes(endPoint)
                else
                    return false
            }

            // if authorized[i] is an object
            for (const key of Object.keys(authorized[i])) {
                status = await checkAthorizedKey(authorized[i], method, endPoint, data, key, unauthorize)
            }

        }

        return status

    }

    async function checkAthorizedKey(authorized, method, endPoint, data, key, unauthorize) {
        let status = false;
        let keyStatus = false;

        // if authorized[key] is a booleaan
        if (authorized[key] === true)
            keyStatus = true

        // if authorized[key] is a string or number
        else if (typeof authorized[key] === "string" || typeof authorized[key] === "number") {
            if (authorized[key] === true || authorized[key] === 'true' || authorized[key] === '*')
                keyStatus = true
            else if (data[key]) {
                keyStatus = await checkArray(authorized, data, key, unauthorize)
                if (await checkFilter(authorized, data, key, unauthorize))
                    status = true
            }
        }

        // if authorized[key] is an array
        else if (Array.isArray(authorized[key])) {
            if (authorized[key].includes(true) || authorized[key].includes('true') || authorized[key].includes('*'))
                keyStatus = true
            else if (data[key]) {
                keyStatus = await checkArray(authorized, data, key, unauthorize)
                if (await checkFilter(authorized, data, key, unauthorize))
                    status = true
            }
        }

        // if authorized[key] is an object
        else if (typeof authorized[key] === "object") {
            console.log('authorized[key] is an object', authorized[key])
        } else
            delete data[key]

        // if key status is false for unauthorized case
        if (!keyStatus || keyStatus && unauthorize) {
            if (!data.unauthorized || !data.unauthorized[method])
                data.unauthorized = { [method]: { [key]: [data[key]] } }
            else if (!data.unauthorized[method][key])
                data.unauthorized[method][key] = [data[key]]
            else
                data.unauthorized[method][key].push(data[key])
        } else
            status = true
        return status
    }

    async function checkArray(authorized, data, key, unauthorize) {
        let keyStatus = false
        let authorizedValue = getValueFromObject(authorized, key);
        let dataValue = getValueFromObject(data, key);

        if (!authorizedValue && !unauthorize) {
            data = deleteKey(data, key)
        } else if (typeof dataValue == "string") {
            if (unauthorize && authorizedValue.includes(dataValue))
                data = deleteKey(data, key)
            else {
                if (!authorizedValue.includes(dataValue))
                    data = deleteKey(data, key)
                else
                    keyStatus = true
            }
        } else if (Array.isArray(dataValue)) {
            for (let i = 0; i < dataValue.length; i++) {
                keyStatus = await checkArray(authorized, data, `${key}[${i}]`, unauthorize)
            }
        } else if (typeof dataValue === "object") {
            let checkKeys = true
            if (dataValue['_id']) {
                if (authorized.object.includes(dataValue['_id']))
                    checkKeys = true
            }
            if (checkKeys) {
                if (authorizedValue['*'] || authorizedValue['*'] == '')
                    keyStatus = true
                else
                    for (const k of Object.keys(dataValue)) {
                        keyStatus = await checkArray(authorized, data, `${key}.${k}`, unauthorize)
                    }
            }
        }

        return keyStatus
    }

    async function checkFilter(authorized, data, apikey, unauthorize) {
        if (data.object.$filter && data.object.$filter.query) {
            let key
            if (data.object.$filter.type == 'object')
                key = '_id'
            else if (data.object.$filter.type == 'array')
                key = 'name'
            if (key) {
                for (let value of authorized[apikey]) {
                    if (value[key])
                        value = value[key]
                    if (unauthorize)
                        data.object.$filter.query.push({ key, value, operator: '$ne', logicalOperator: 'or' })
                    else
                        data.object.$filter.query.push({ key, value, operator: '$eq', logicalOperator: 'or' })
                }
                if (!unauthorize)
                    return true
            }
        }
    }

    function deleteKey(data, path) {
        if (!data || !path) return
        if (path.includes('._id'))
            path = path.replace('._id', '');
        data = dotNotationToObject({ [path]: undefined }, data)
        return data
    }

    return {
        check
    }

}));
