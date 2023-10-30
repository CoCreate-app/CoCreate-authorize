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
            if (authorization && authorization.key && organizations[organization_id] && organizations[organization_id][authorization.key]) {
                let newAuthorization = await readAuthorization(authorization.key, organization_id)
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

    async function getAuthorization(key, organization_id) {
        if (!organizations[organization_id])
            organizations[organization_id] = {}

        if (!organizations[organization_id][key])
            organizations[organization_id][key] = readAuthorization(key, organization_id);

        organizations[organization_id][key] = await organizations[organization_id][key]
        return organizations[organization_id][key]
    }

    async function readAuthorization(key, organization_id) {
        try {
            if (!organization_id)
                return { error: 'An organization_id is required' };

            let request = {
                method: 'object.read',
                database: organization_id,
                array: 'keys',
                organization_id,
                $filter: {
                    query: []
                }
            }

            if (key)
                request.$filter.query.push({ key: 'key', value: key, operator: '$eq' })
            else
                request.$filter.query.push({ key: 'default', value: true, operator: '$eq' })


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

                    authorization = await createAuthorization(authorization, roles)
                }
                return authorization;
            } else
                return {}
        } catch (error) {
            console.log("authorization Error", error)
            return { error };
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
        if (!data.organization_id)
            return { error: 'organization_id is required' };
        if (!data.method)
            return { error: 'method is required' };

        let authorized = await getAuthorization(key, data.organization_id)
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

        let status = await checkMethod(data, authorized.actions, data.method)

        console.log(data.method, status)

        if (!status) {
            // if (data.method === 'object.read' && data.array.includes('organizations'))
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
            let newmatch = data.method.replace(match, '')

            if (Array.isArray(authorized)) {
                for (let i = 0; i < authorized.length; i++) {
                    status = await checkMethodMatch(data, authorized[i], newmatch)
                }
            } else if (typeof authorized === 'object') {
                let keys = Object.keys(authorized);

                if (data.method === 'object.read' && data.array.includes('organizations'))
                    console.log('test')

                for (const key of keys) {
                    if (key.includes('$'))
                        status = await checkMethodOperators(data, key, authorized[key])
                    else if (newmatch && (authorized[newmatch] || authorized['*'])) {
                        status = await checkMethodMatch(data, authorized[newmatch] || authorized['*'], newmatch)
                        if (status === false)
                            return false
                    } else {
                        // TODO: check if key contains query operators and query data to return true | false
                        return true
                    }
                }
            }
            return status
        }
    }

    async function checkMethodOperators(data, key, value) {
        if (value === 'this.userId' && data.socket)
            value = data.socket.user_id
        if (['$storage', '$database', '$array', '$index', '$object'].includes(key))
            console.log('key is a crud type operator', key)
        else {
            let keys = key.split('.')
            let query = { key: keys[1], value, operator: keys[0] }
            if (!data.$filter)
                data.$filter = { query: [query] }
            else if (!data.$filter.query)
                data.$filter.query = [query]
            else
                data.$filter.query.push(query)

            console.log('key is a query operator', key)
        }
        return true
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
