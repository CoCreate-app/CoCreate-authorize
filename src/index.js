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

    const organizations = {}

    if (isBrowser) {
        crud.listen('object.update', function (data) {
            updateAuthorization(data)
        });

        crud.listen('object.delete', function (data) {
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
            if (authorization && authorization.key && organizations[organization_id] && organizations[organization_id][authorization.key]) {
                let newAuthorization = await readAuthorization(authorization.key, data)
                organizations[organization_id][authorization.key] = newAuthorization
            }
        }
    }

    async function deleteAuthorization(data) {
        const { array, object, organization_id } = data

        if (array === 'keys' && object) {
            let authorization = object[0]
            if (authorization && authorization.key && organizations[organization_id] && organizations[organization_id][authorization.key]) {
                delete organizations[organization_id][authorization.key]
            }
        }
    }

    async function getAuthorization(key, data) {
        let organization_id = data.organization_id
        if (!organizations[organization_id])
            organizations[organization_id] = {}

        if (!organizations[organization_id][key])
            organizations[organization_id][key] = readAuthorization(key, data);

        organizations[organization_id][key] = await organizations[organization_id][key]
        return organizations[organization_id][key]
    }

    async function readAuthorization(key, data) {
        try {
            let organization_id = data.organization_id
            if (!organization_id)
                return { error: 'An organization_id is required' };

            let request = {
                method: 'object.read',
                host: data.host,
                database: organization_id,
                array: 'keys',
                organization_id,
                $filter: {
                    query: {}
                }
            }

            if (key)
                request.$filter.query.key = key
            else
                request.$filter.query.default = true


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

                    delete request.$filter
                    delete request.isFilter

                    request.object = role_ids

                    let roles = await crud.send(request)
                    roles = roles.object

                    for (let role of roles) {
                        authorization = dotNotationToObject(authorization, role)
                    }
                }
                return authorization;
            } else
                return {}
        } catch (error) {
            console.log("authorization Error", error)
            return { error };
        }

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
        if (!data.organization_id)
            return { error: 'organization_id is required' };
        if (!data.method)
            return { error: 'method is required' };

        let authorized = await getAuthorization(key, data)
        if (!authorized || authorized.error)
            return authorized
        if (authorized.organization_id !== data.organization_id)
            return false;
        if (authorized.host && authorized.host.length) {
            if (!authorized.host || (!authorized.host.includes(data.host) && !authorized.host.includes("*")))
                return false;
        }
        if (authorized.admin === 'true' || authorized.admin === true)
            return true;
        if (!authorized.actions)
            return { error: "Authorization does not have any actions defined" };

        let status = await checkMethod(data, authorized.actions, data.method)

        // console.log(data.method, data.array, status)

        if (!status) {
            return false
        }

        return { authorized: data };
    }

    async function checkMethod(data, authorized, method) {
        if (authorized[method]) {
            return await checkMethodMatch(data, authorized[method], method)
        } else if (method.includes('.')) {
            let match = ''
            let splitMethod = method.split('.')
            for (let i = 0; i < splitMethod.length; i++) {
                if (!match)
                    match = splitMethod[i]
                else
                    match += '.' + splitMethod[i]
                if (authorized[match]) {
                    return await checkMethodMatch(data, authorized[match], match)
                } else if (i === splitMethod.length - 1)
                    return false
            }
        } else
            return false;
    }

    async function checkMethodMatch(data, authorized, match) {
        if (typeof authorized === 'boolean') {
            return authorized
        } else if (typeof authorized === 'string') {
            if (authorized === 'false')
                return false
            else if (authorized === 'true')
                return true
            else if (authorized === match)
                return true // check string for match or mutate data
            else
                return true // check string for match or mutate data
        } else if (typeof authorized === 'number') {
            return !!authorized
        } else {
            let status = false
            let newmatch = data.method.replace(match + '.', '')

            if (Array.isArray(authorized)) {
                for (let i = 0; i < authorized.length; i++) {
                    status = await checkMethodMatch(data, authorized[i], newmatch)
                }
            } else if (typeof authorized === 'object') {
                for (const key of Object.keys(authorized)) {
                    if (key.includes('$')) {
                        if (['$storage', '$database', '$array', '$index'].includes(key)) {
                            let opStatus = await checkMethodOperators(data, key, authorized[key])
                            if (opStatus === true || opStatus === false)
                                status = opStatus
                        } else {
                            let isFilter = applyFilter(data, authorized[key], key)
                            console.log('isFIlter', isFilter)
                        }
                    }
                }
            }
            if (newmatch) {
                if (!status && authorized[newmatch]) {
                    status = await checkMethodMatch(data, authorized[newmatch], newmatch)
                }
                if (!status && authorized['*']) {
                    status = await checkMethodMatch(data, authorized['*'], newmatch)
                }
            }

            return status
        }
    }

    async function checkMethodOperators(data, key, authorization) {
        try {
            // Adjust authorization if it's based on a dynamic user ID from sockets
            if (authorization === '$user_id' && data.socket) {
                authorization = data.socket.user_id || data.user_id;
            }

            if (key.startsWith('$')) {
                let type = key.substring(1);

                if (!data[type]) {
                    return undefined;
                }

                if (typeof data[type] === 'string') {
                    return checkAuthorizationData(data, authorization, data[type])
                } else if (Array.isArray(data[type])) {
                    if (!data[type].length)
                        return undefined
                    // ToDo: Current stratergy checks if all items match else false will be returned 
                    let allAuthorized = true;
                    for (let i = 0; i < data[type].length; i++) {
                        const itemData = typeof data[type][i] === 'object' ? data[type][i].name : data[type][i];
                        const authResult = checkAuthorizationData(data, authorization, itemData);
                        if (authResult === false) {
                            return false;  // Return false as soon as one item is unauthorized
                        } else if (authResult === undefined) {
                            allAuthorized = undefined
                        }
                    }
                    return allAuthorized;
                } else if (typeof data[type] === 'object') {
                    return checkAuthorizationData(data, authorization, data[type].name)
                }
            }
            return undefined;
        } catch (e) {
            console.log(e);
            return undefined;
        }
    }

    function checkAuthorizationData(data, authorization, key) {
        if (typeof authorization === 'string') {
            if (key === authorization)
                return true
            else
                return undefined
        } else if (Array.isArray(authorization)) {
            if (authorization.includes(key))
                return true
            else
                return undefined
        } else if (typeof authorization === 'object') {
            if (typeof authorization[key] === 'object') {
                for (const queryKey of Object.keys(authorization[key])) {
                    return applyFilter(data, authorization[key], queryKey)
                }
            } else if (authorization[key] === false || authorization[key] === 'false')
                return false
            else if (authorization[key])
                return true
            else
                return undefined
        }
    }

    function applyFilter(data, authorization, authorizationKey) {
        let keyParts = authorizationKey.split('.');
        let operator = keyParts.pop();
        let key = keyParts.join('.');
        if (['$eq', '$ne', '$lt', '$lte', '$gt', '$gte', '$in', '$nin', '$or', '$and', '$not', '$nor', '$exists', '$type', '$mod', '$regex', '$text', '$where', '$all', '$elemMatch', '$size'].includes(operator)) {
            if (!data.$filter)
                data.$filter = { query: {} }
            else if (!data.$filter.query)
                data.$filter.query = {}

            if (authorization[authorizationKey] === '$user_id' && data.socket) {
                authorization[authorizationKey] = data.socket.user_id || data.user_id;
            }

            data.$filter.query[key] = { [operator]: authorization[authorizationKey] }

            return true
        }
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
                    if (!data.object.$filter.query.$or)
                        data.object.$filter.query.$or = []
                    if (unauthorize)
                        data.object.$filter.query.$or.push({ [key]: { $ne: value } })
                    else
                        data.object.$filter.query.$or.push({ [key]: value })
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
