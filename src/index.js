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

    const permissions = new Map()

    if (isBrowser) {
        crud.listen('update.object', function (data) {
            updatePermission(data)
        });

        crud.listen('delete.object', function (data) {
            deletePermission(data)
        });
    } else {
        process.on('changed-object', async (data) => {
            updatePermission(data)
        })
    }

    async function updatePermission(data) {
        const { array, object, organization_id } = data

        if (array === 'keys' && object) {
            let permission = object[0]
            if (permission && permission.key && hasPermission(permission.key)) {
                let newPermission = await readPermisson(permission.key, organization_id)
                setPermission(permission.key, newPermission)
            }
        }
    }

    async function deletePermission(data) {
        const { array, object, organization_id } = data

        if (array === 'keys' && object) {
            let permission = object[0]
            if (permission && permission.key && hasPermission(permission.key)) {
                permissions.delete(permission.key)
            }
        }
    }

    function setPermission(key, permission) {
        permissions.set(key, permission)
    }

    function hasPermission(key) {
        return permissions.has(key)
    }

    async function getPermission(key, organization_id) {
        if (permissions.get(key)) {
            return permissions.get(key)
        } else {
            let permission = await readPermisson(key, organization_id);
            permissions.set(key, permission)
            return permission
        }
    }

    async function readPermisson(key, organization_id) {
        try {
            if (!organization_id)
                return null;

            let request = {
                array: 'keys',
                organization_id,
                filter: {
                    query: []
                }
            }

            if (key)
                request.filter.query.push({ key: 'key', value: key, operator: '$eq' })
            else
                request.filter.query.push({ key: 'default', value: true, operator: '$eq' })


            let permission = await crud.sent(request)
            if (permission && permission.object && permission.object[0]) {
                permission = permission.object[0]

                if (!permission.arrays) {
                    permission.arrays = {};
                }

                if (permission && permission.roles) {
                    const role_ids = []
                    permission.roles.forEach((_id) => {
                        if (_id)
                            role_ids.push({ _id })
                    })

                    delete request.filter
                    delete request.request
                    request.object = role_ids

                    let roles = await crud.send(request)
                    roles = roles.object

                    permission = createPermissionObject(permission, roles)
                }

            }

            return permission;

        } catch (error) {
            console.log("Permission Error", error)
            return null;
        }

    }

    async function createPermissionObject(permission, roles) {
        roles.map(role => {
            for (const roleKey in role) {
                if (!["_id", "type", "name", "organization_id"].includes(roleKey)) {
                    if (!permission[roleKey]) {
                        permission[roleKey] = role[roleKey]
                    } else {
                        if (Array.isArray(role[roleKey])) {
                            for (let item of role[roleKey]) {
                                if (!permission[roleKey].includes(item))
                                    permission[roleKey].push(item)
                            }
                        }
                        else if (typeof role[roleKey] == 'object') {
                            for (const c of Object.keys(role[roleKey])) {
                                if (!permission[roleKey][c]) {
                                    permission[roleKey][c] = role[roleKey][c]
                                } else {
                                    if (typeof role[roleKey][c] == 'object') {
                                        permission[roleKey][c] = { ...permission[roleKey][c], ...role[roleKey][c] }
                                    } else {
                                        permission[roleKey][c] = role[roleKey][c]
                                    }
                                }
                            }
                        } else {
                            permission[roleKey] = role[roleKey]
                        }
                    }
                }
            }
        })
        return permission;
    }

    async function check(data, user_id) {
        let permission = false
        if (user_id) {
            permission = await checkPermissionObject({
                key: user_id,
                data
            })
        }
        if (!permission || permission.error) {
            permission = await checkPermissionObject({
                key: data.key,
                data
            })
        }
        return permission;
    }

    async function checkPermissionObject({ key, data }) {
        let action = data.method
        let { organization_id, filter, endPoint } = data
        if (!key || !organization_id) return false;

        let permission = await getPermission(key, organization_id)
        if (!permission || permission.error)
            return permission
        if (permission.organization_id !== organization_id)
            return false;
        if (permission.host && permission.host.length) {
            if (!permission.host || (!permission.host.includes(data.host) && !permission.host.includes("*")))
                return false;

        }
        if (permission.admin == 'true' || permission.admin === true)
            return true;

        let status = await checkAction(permission.actions, action, endPoint, data, filter)

        if (!status)
            return false

        return { authorized: data };
    }

    async function checkAction(permissions, action, endPoint, data) {
        if (!permissions || !action || !permissions[action] || permissions[action] == 'false') return false;
        if (permissions[action] === true || permissions[action] == 'true' || permissions[action] == '*') return true;

        let authorized = permissions[action].authorize
        if (authorized) {
            let status = await checkAthorized(authorized, action, endPoint, data)
            if (!status)
                return false
            else {
                let unauthorized = permissions[action].unauthorize
                if (unauthorized) {
                    let status = await checkAthorized(unauthorized, action, endPoint, data, true)
                    if (status)
                        return false
                }
                return true
            }
        } else
            return false
    }

    async function checkAthorized(authorized, action, endPoint, data, unauthorize) {
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
                status = await checkAthorizedKey(authorized[i], action, endPoint, data, key, unauthorize)
            }

        }

        return status

    }

    async function checkAthorizedKey(authorized, action, endPoint, data, key, unauthorize) {
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
            if (!data.unauthorized || !data.unauthorized[action])
                data.unauthorized = { [action]: { [key]: [data[key]] } }
            else if (!data.unauthorized[action][key])
                data.unauthorized[action][key] = [data[key]]
            else
                data.unauthorized[action][key].push(data[key])
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
        if (data.filter && data.filter.query) {
            let key
            if (data.filter.type == 'object')
                key = '_id'
            else if (data.filter.type == 'array')
                key = 'name'
            if (key) {
                for (let value of authorized[apikey]) {
                    if (value[key])
                        value = value[key]
                    if (unauthorize)
                        data.filter.query.push({ key, value, operator: '$ne', logicalOperator: 'or' })
                    else
                        data.filter.query.push({ key, value, operator: '$eq', logicalOperator: 'or' })
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
