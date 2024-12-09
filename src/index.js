(function (root, factory) {
	if (typeof define === "function" && define.amd) {
		define(["@cocreate/crud-client", "@cocreate/utils"], function (
			crud,
			{ getValueFromObject, dotNotationToObject }
		) {
			return factory(true, crud, {
				getValueFromObject,
				dotNotationToObject
			});
		});
	} else if (typeof module === "object" && module.exports) {
		const {
			getValueFromObject,
			dotNotationToObject
		} = require("@cocreate/utils");
		module.exports = class CoCreateAuthorize {
			constructor(crud) {
				return factory(false, crud, {
					getValueFromObject,
					dotNotationToObject
				});
			}
		};
	} else {
		root.returnExports = factory(
			true,
			root["@cocreate/crud-client"],
			root["@cocreate/utils"]
		);
	}
})(
	typeof self !== "undefined" ? self : this,
	function (isBrowser, crud, { getValueFromObject, dotNotationToObject }) {
		const organizations = {};

		if (isBrowser) {
			crud.listen("object.update", function (data) {
				updateAuthorization(data);
			});

			crud.listen("object.delete", function (data) {
				deleteAuthorization(data);
			});
		} else {
			process.on("crud-event", async (data) => {
				updateAuthorization(data);
			});
		}

		/**
		 * Updates the cached authorization for a specific key within an organization.
		 *
		 * This function checks if the `array` is `"keys"` and if an authorization object is provided.
		 * If the conditions are met, it fetches the latest authorization details using the `readAuthorization`
		 * function and updates the cache for the given `organization_id` and `key`.
		 *
		 * @param {object} data - The data object containing:
		 *   - `array`: The type of collection being updated (e.g., "keys").
		 *   - `object`: The object array containing the authorization details.
		 *   - `organization_id`: The ID of the organization the authorization belongs to.
		 * @returns {Promise<void>} Resolves when the update is complete.
		 */
		async function updateAuthorization(data) {
			const { array, object, organization_id } = data;

			// Ensure we're working with "keys" and an authorization object is provided
			if (array === "keys" && object) {
				let authorization = object[0];

				// Check if the authorization key exists in the cache
				if (
					authorization &&
					authorization.key &&
					organizations[organization_id] &&
					organizations[organization_id][authorization.key]
				) {
					// Fetch the latest authorization details
					let newAuthorization = await readAuthorization(
						authorization.key,
						data
					);

					// Update the cache with the new authorization details
					organizations[organization_id][authorization.key] =
						newAuthorization;
				}
			}
		}

		/**
		 * Deletes the cached authorization for a specific key within an organization.
		 *
		 * This function checks if the `array` is `"keys"` and if an authorization object is provided.
		 * If the conditions are met, it removes the cached authorization for the given
		 * `organization_id` and `key` from the `organizations` cache.
		 *
		 * @param {object} data - The data object containing:
		 *   - `array`: The type of collection being deleted (e.g., "keys").
		 *   - `object`: The object array containing the authorization details.
		 *   - `organization_id`: The ID of the organization the authorization belongs to.
		 * @returns {Promise<void>} Resolves when the deletion is complete.
		 */
		async function deleteAuthorization(data) {
			const { array, object, organization_id } = data;

			// Ensure we're working with "keys" and an authorization object is provided
			if (array === "keys" && object) {
				let authorization = object[0];

				// Check if the authorization key exists in the cache
				if (
					authorization &&
					authorization.key &&
					organizations[organization_id] &&
					organizations[organization_id][authorization.key]
				) {
					// Remove the cached authorization for the given key
					delete organizations[organization_id][authorization.key];
				}
			}
		}

		/**
		 * Retrieves the cached authorization for a specific key within an organization.
		 *
		 * If the authorization is not cached, this function fetches the authorization
		 * details using the `readAuthorization` function and stores it in the cache.
		 *
		 * @param {string} key - The authorization key (e.g., user ID or API key).
		 * @param {object} data - The data object containing:
		 *   - `organization_id`: The ID of the organization the authorization belongs to.
		 * @returns {Promise<object>} A promise that resolves to the authorization details.
		 */
		async function getAuthorization(key, data) {
			let organization_id = data.organization_id;

			// Initialize the cache for the organization if it doesn't exist
			if (!organizations[organization_id])
				organizations[organization_id] = {};

			// If the authorization for the key is not cached, fetch and cache it
			if (!organizations[organization_id][key])
				organizations[organization_id][key] = readAuthorization(
					key,
					data
				);

			// Await the authorization (handles the promise stored during the initial fetch)
			organizations[organization_id][key] = await organizations[
				organization_id
			][key];

			return organizations[organization_id][key];
		}

		/**
		 * Reads authorization details for a given key (user ID or API key) and organization.
		 *
		 * This function constructs a request to retrieve authorization details from the database.
		 * If the `key` is provided, it queries for the specific authorization key.
		 * If no `key` is provided, it queries for the default authorization settings.
		 *
		 * Additionally, it resolves roles associated with the authorization and merges role permissions
		 * into the final authorization object.
		 *
		 * @param {string} key - The authorization key (e.g., user ID or API key).
		 * @param {object} data - The data object containing request details, such as the `organization_id` and `host`.
		 * @returns {Promise<object>} A promise that resolves to the authorization object or an error message.
		 */
		async function readAuthorization(key, data) {
			try {
				// Extract and validate the organization_id
				let organization_id = data.organization_id;
				if (!organization_id)
					return { error: "An organization_id is required" };

				// Construct the initial request for authorization data
				let request = {
					method: "object.read", // CRUD method to read the object
					host: data.host, // Host associated with the request
					database: organization_id, // Database scoped to the organization
					array: "keys", // Collection or array to query
					organization_id, // Organization context for the request
					$filter: {
						query: {} // Query filters to apply
					}
				};

				// Add query filters based on the key or default authorization
				if (key) request.$filter.query.key = key;
				else request.$filter.query.default = true;

				// Send the request to the CRUD layer
				let authorization = await crud.send(request);

				// If authorization data exists, process the roles and permissions
				if (
					authorization &&
					authorization.object &&
					authorization.object[0]
				) {
					authorization = authorization.object[0];

					// Ensure the 'arrays' field exists to prevent undefined references
					if (!authorization.arrays) {
						authorization.arrays = {};
					}

					// Process roles associated with the authorization
					if (authorization && authorization.roles) {
						const role_ids = [];
						authorization.roles.forEach((_id) => {
							if (_id) role_ids.push({ _id });
						});

						// Prepare a new request to fetch role details
						delete request.$filter;
						delete request.isFilter;

						request.object = role_ids;

						// Retrieve and merge role permissions into the authorization object
						let roles = await crud.send(request);
						roles = roles.object;

						for (let role of roles) {
							authorization = dotNotationToObject(
								authorization,
								role
							);
						}
					}
					return authorization; // Return the final authorization object
				} else {
					// Return an empty object if no authorization is found
					return {};
				}
			} catch (error) {
				// Handle and log any errors during the process
				console.log("authorization Error", error);
				return { error };
			}
		}

		/**
		 * Validates the authorization of a user or an API key to perform an action.
		 *
		 * The function first checks authorization using the provided `user_id`.
		 * If that fails or returns an error, it checks the authorization using the `apikey`
		 * present in the `data` object.
		 *
		 * @param {object} data - The data object containing request details, such as the `apikey` and `organization_id`.
		 * @param {string} user_id - The user ID for authorization validation.
		 * @returns {Promise<object|boolean>} A promise that resolves to the authorization result:
		 *                                    - `false` if unauthorized.
		 *                                    - An object with authorization details if authorized.
		 */
		async function check(data, user_id) {
			let authorization = false;

			// Attempt to check authorization with the user ID if provided
			if (user_id) {
				authorization = await checkAuthorization({
					key: user_id,
					data
				});
			}

			// Fallback to checking authorization with the API key if user ID check fails
			if (!authorization || authorization.error) {
				authorization = await checkAuthorization({
					key: data.apikey,
					data
				});
			}

			return authorization;
		}

		/**
		 * Checks whether a given key (user ID or API key) is authorized to perform the specified action.
		 *
		 * The function validates the presence of required fields in the `data` object (`organization_id`, `method`),
		 * fetches authorization details, and performs checks such as:
		 * - Organization ID matching.
		 * - Host-level restrictions.
		 * - Admin privileges.
		 * - Defined actions and their permissions.
		 *
		 * @param {object} params - The parameters for the function.
		 * @param {string} params.key - The key used for authorization (user ID or API key).
		 * @param {object} params.data - The data object containing details like `organization_id`, `host`, and `method`.
		 * @returns {Promise<object|boolean>} A promise that resolves to:
		 *                                    - An object with an error message if validation fails.
		 *                                    - `false` if authorization checks fail.
		 *                                    - `true` or an object with sanitized `data` if authorized.
		 */
		async function checkAuthorization({ key, data }) {
			// Validate required fields
			if (!data.organization_id)
				return { error: "organization_id is required" };
			if (!data.method) return { error: "method is required" };

			// Fetch authorization details using the provided key
			let authorized = await getAuthorization(key, data);

			// If no authorization details or an error is returned, propagate the error or deny access
			if (!authorized || authorized.error) return authorized;

			// Ensure the organization ID matches
			if (authorized.organization_id !== data.organization_id)
				return false;

			// Validate host restrictions if specified
			if (authorized.host && authorized.host.length) {
				if (
					!authorized.host ||
					(!authorized.host.includes(data.host) &&
						!authorized.host.includes("*"))
				)
					return false;
			}

			// Allow access if the user has admin privileges
			if (authorized.admin === "true" || authorized.admin === true)
				return true;

			// Ensure actions are defined for the authorization
			if (!authorized.actions)
				return {
					error: "Authorization does not have any actions defined"
				};

			// Check if the requested method is allowed under the defined actions
			let status = await checkMethod(
				data,
				authorized.actions,
				data.method
			);

			// If the method check fails, deny access
			if (!status) {
				return false;
			}

			// Return the sanitized and authorized data if all checks pass
			return { authorized: data };
		}

		/**
		 * Validates whether a method is permitted based on the authorization rules.
		 *
		 * This function checks for an exact match of the `method` in the `authorized` actions.
		 * If no exact match is found, it checks progressively for partial matches using dot notation (e.g., "read.user").
		 *
		 * @param {object} data - The data object containing request details.
		 * @param {object} authorized - The authorization rules object mapping methods to permissions.
		 * @param {string} method - The method to validate (e.g., "read.user").
		 * @returns {Promise<boolean>} A promise that resolves to `true` if the method is authorized, `false` otherwise.
		 */
		async function checkMethod(data, authorized, method) {
			// Check for an exact match of the method in the authorization rules
			if (authorized[method]) {
				return await checkMethodMatch(data, authorized[method], method);
			}
			// Check for partial matches using dot notation (e.g., "read.user")
			else if (method.includes(".")) {
				let match = "";
				let splitMethod = method.split(".");

				for (let i = 0; i < splitMethod.length; i++) {
					if (!match) match = splitMethod[i];
					else match += "." + splitMethod[i];

					// If a partial match is found, validate it
					if (authorized[match]) {
						return await checkMethodMatch(
							data,
							authorized[match],
							match
						);
					}
					// If the last segment has no match, deny access
					else if (i === splitMethod.length - 1) return false;
				}
			}
			// Deny access if no match is found
			else return false;
		}

		/**
		 * Checks whether a given method matches the authorized permissions and
		 * optionally sanitizes the provided data based on inclusion and exclusion rules.
		 *
		 * This function supports various types of authorization configurations, including:
		 * - Booleans: Directly allow (`true`) or deny (`false`).
		 * - Strings: Match the authorization string with the method or default to allow.
		 * - Numbers: Treat any non-zero number as `true` (authorized).
		 * - Arrays: Recursively check multiple authorization rules.
		 * - Objects: Evaluate nested authorization rules and apply inclusion/exclusion logic.
		 *
		 * The function also aggregates all inclusion and exclusion rules before sanitizing
		 * the data, ensuring consistent prioritization logic is applied holistically.
		 *
		 * @param {object} data - The data object containing the method and other fields to process.
		 * @param {boolean | string | number | object | Array} authorized - The authorization rules.
		 * @param {string} match - The method string to match against the authorization rules.
		 * @returns {Promise<boolean>} A promise that resolves to `true` if the method is authorized,
		 *                             `false` otherwise.
		 *
		 * @example
		 * // Example usage:
		 * const data = { method: "read", read: { field1: "value1", field2: "value2" } };
		 * const authorized = { read: [{ field1: true }, { field2: false }] };
		 * const match = "read";
		 *
		 * checkMethodMatch(data, authorized, match).then((isAuthorized) => {
		 *   console.log(isAuthorized); // true
		 *   console.log(data); // { method: "read", read: { field1: "value1" } }
		 * });
		 */
		async function checkMethodMatch(data, authorized, match) {
			if (typeof authorized === "boolean") {
				return authorized;
			} else if (typeof authorized === "string") {
				if (authorized === "false") return false;
				else if (authorized === "true") return true;
				else if (authorized === match) return true;
				else return true;
			} else if (typeof authorized === "number") {
				return !!authorized;
			} else {
				let status = false;
				let newmatch = data.method.replace(match + ".", "");

				// Aggregate raw keys
				let rawKeys = [];

				if (Array.isArray(authorized)) {
					for (let i = 0; i < authorized.length; i++) {
						status = await checkMethodMatch(
							data,
							authorized[i],
							newmatch
						);
					}
				} else if (typeof authorized === "object") {
					for (const key of Object.keys(authorized)) {
						if (key.includes("$")) {
							if (
								[
									"$storage",
									"$database",
									"$array",
									"$index"
								].includes(key)
							) {
								let opStatus = await checkMethodOperators(
									data,
									key,
									authorized[key]
								);
								if (opStatus === true || opStatus === false)
									status = opStatus;
							} else if (key === "$keys") {
								let type = data.method.split(".")[0];
								if (data[type]) {
									rawKeys.push(authorized[key]); // Collect raw authorization keys
								}
							} else {
								let isFilter = applyFilter(
									data,
									authorized[key],
									key
								);
								console.log("isFilter", isFilter);
							}
						}
					}
				}

				// Parse all raw keys together to get inclusion/exclusion
				let { inclusion, exclusion } = parsePermissions(rawKeys);

				// Apply sanitization if there are inclusion or exclusion rules
				if (inclusion || exclusion) {
					let type = data.method.split(".")[0]; // Extract type from method
					if (data[type]) {
						data[type] = sanitizeData(
							data[type],
							inclusion,
							exclusion
						);
						status = true;
					}
				}

				if (newmatch) {
					if (!status && authorized[newmatch]) {
						status = await checkMethodMatch(
							data,
							authorized[newmatch],
							newmatch
						);
					}
					if (!status && authorized["*"]) {
						status = await checkMethodMatch(
							data,
							authorized["*"],
							newmatch
						);
					}
				}

				return status;
			}
		}

		/**
		 * Checks method operators to validate authorization based on dynamic data types and keys.
		 *
		 * @param {Object} data - The input data object containing various properties.
		 * @param {string} key - A string key to determine the type of operation,
		 *                       starting with `$` for dynamic type-based checks.
		 * @param {string} authorization - The authorization identifier, which could be a static value
		 *                                  or a dynamic reference like `$user_id`.
		 *
		 * @returns {boolean|undefined} - Returns `true` if authorized, `false` if unauthorized,
		 *                                or `undefined` if no validation applies.
		 *
		 * This function:
		 * - Dynamically resolves `authorization` when `$user_id` is used and `data.socket` contains user information.
		 * - Handles dynamic key-based operations using a `$` prefix (e.g., `$type`).
		 * - Validates authorization for strings, arrays, and objects in `data[type]`:
		 *   - For strings: Directly validates using `checkAuthorizationData`.
		 *   - For arrays: Validates each item. Returns `false` if any item fails validation.
		 *                 If all items are valid, returns `true`. Returns `undefined` if the array is empty.
		 *   - For objects: Validates based on the `name` property of the object.
		 *
		 * Example Usage:
		 * ```
		 * const data = {
		 *   socket: { user_id: "123" },
		 *   roles: ["admin", "editor"]
		 * };
		 * const result = checkMethodOperators(data, "$roles", "$user_id");
		 * ```
		 */
		async function checkMethodOperators(data, key, authorization) {
			try {
				// Adjust authorization dynamically if `$user_id` is provided and user info exists in the socket
				if (authorization === "$user_id" && data.socket) {
					authorization = data.socket.user_id || data.user_id;
				}

				// Check if the key starts with `$`, indicating a dynamic type-based operation
				if (key.startsWith("$")) {
					let type = key.substring(1); // Extract the type by removing `$`

					// If the specified type does not exist in data, return undefined
					if (!data[type]) {
						return undefined;
					}

					// Handle cases where the type is a string
					if (typeof data[type] === "string") {
						return checkAuthorizationData(
							data,
							authorization,
							data[type]
						);
					}
					// Handle cases where the type is an array
					else if (Array.isArray(data[type])) {
						if (!data[type].length) return undefined; // Return undefined for empty arrays

						// ToDo: Current strategy ensures all items must match; adjust as needed
						let allAuthorized = true;
						for (let i = 0; i < data[type].length; i++) {
							const itemData =
								typeof data[type][i] === "object"
									? data[type][i].name // Extract name if the item is an object
									: data[type][i];
							const authResult = checkAuthorizationData(
								data,
								authorization,
								itemData
							);
							if (authResult === false) {
								return false; // Return false if any item fails validation
							} else if (authResult === undefined) {
								allAuthorized = undefined; // Mark as undefined if any validation is inconclusive
							}
						}
						return allAuthorized;
					}
					// Handle cases where the type is an object
					else if (typeof data[type] === "object") {
						return checkAuthorizationData(
							data,
							authorization,
							data[type].name
						);
					}
				}

				// Return undefined if no conditions match
				return undefined;
			} catch (e) {
				// Log the error and return undefined in case of an exception
				console.log(e);
				return undefined;
			}
		}

		/**
		 * Checks if the provided key is authorized based on the authorization rules.
		 *
		 * @param {Object} data - The data object to be used in filtering.
		 * @param {string|Array|Object} authorization - The authorization rules, which can be a string, array, or object.
		 * @param {string} key - The key to be checked against the authorization rules.
		 * @returns {boolean|undefined} - Returns true if authorized, false if explicitly unauthorized, and undefined if no rule matches.
		 */
		function checkAuthorizationData(data, authorization, key) {
			// If the authorization is a string, check if it matches the key.
			if (typeof authorization === "string") {
				if (key === authorization)
					return true; // Key matches the authorization string.
				else return undefined; // No match, return undefined.
			}
			// If the authorization is an array, check if the key is included in the array.
			else if (Array.isArray(authorization)) {
				if (authorization.includes(key))
					return true; // Key is included in the array.
				else return undefined; // Key not found, return undefined.
			}
			// If the authorization is an object, handle various object-based rules.
			else if (typeof authorization === "object") {
				// If the authorization[key] is an object, apply filters recursively.
				if (typeof authorization[key] === "object") {
					for (const queryKey of Object.keys(authorization[key])) {
						return applyFilter(data, authorization[key], queryKey); // Apply the filter logic.
					}
				}
				// If authorization[key] is explicitly false or "false", return false.
				else if (
					authorization[key] === false ||
					authorization[key] === "false"
				)
					return false;
				// If authorization[key] exists and is truthy, return true.
				else if (authorization[key]) return true;
				// If none of the above conditions match, return undefined.
				else return undefined;
			}
		}

		function applyFilter(data, authorization, authorizationKey) {
			let keyParts = authorizationKey.split(".");
			let operator = keyParts.pop();
			let key = keyParts.join(".");
			if (
				[
					"$eq",
					"$ne",
					"$lt",
					"$lte",
					"$gt",
					"$gte",
					"$in",
					"$nin",
					"$or",
					"$and",
					"$not",
					"$nor",
					"$exists",
					"$type",
					"$mod",
					"$regex",
					"$text",
					"$where",
					"$all",
					"$elemMatch",
					"$size"
				].includes(operator)
			) {
				if (!data.$filter) data.$filter = { query: {} };
				else if (!data.$filter.query) data.$filter.query = {};

				if (
					authorization[authorizationKey] === "$user_id" &&
					data.socket
				) {
					authorization[authorizationKey] =
						data.socket.user_id || data.user_id;
				}

				if (typeof authorization === "string")
					data.$filter.query[key] = {
						[operator]: authorization
					};
				else
					data.$filter.query[key] = {
						[operator]: authorization[authorizationKey]
					};

				return true;
			}
		}

		/**
		 * Parses permissions into inclusion and exclusion arrays.
		 *
		 * @param {string | object | Array<string | object>} authorization - The authorization to parse.
		 * @returns {object} An object containing 'inclusion' and 'exclusion' arrays.
		 */
		function parsePermissions(authorization) {
			// Initialize local arrays for inclusion and exclusion
			const inclusion = [];
			const exclusion = [];

			// Helper function to process a single permission entry
			function processPermission(entry) {
				if (typeof entry === "string") {
					// Treat string as inclusion
					inclusion.push(entry);
				} else if (typeof entry === "object" && entry !== null) {
					for (const [key, value] of Object.entries(entry)) {
						if (value === true) {
							inclusion.push(key);
						} else if (value === false) {
							exclusion.push(key);
						}
						// Ignore entries where value is neither true nor false
					}
				}
				// Ignore entries that are neither string nor object
			}

			// Normalize the input into an array of permission entries
			let permissionEntries = [];

			if (Array.isArray(authorization)) {
				permissionEntries = authorization;
			} else if (
				typeof authorization === "string" ||
				(typeof authorization === "object" && authorization !== null)
			) {
				permissionEntries = [authorization];
			}
			// If authorization is undefined or null, treat as empty

			// Process each permission entry
			permissionEntries.forEach(processPermission);

			// Apply prioritization logic
			if (inclusion.length > 0) {
				// If any inclusion exists, disregard exclusions
				return { inclusion, exclusion: null };
			} else if (exclusion.length > 0) {
				// If only exclusions exist, disregard inclusions
				return { inclusion: null, exclusion };
			} else {
				// If neither exists, set both to null
				return { inclusion: null, exclusion: null };
			}
		}

		/**
		 * Sanitizes data based on parsed permissions.
		 *
		 * @param {object | Array} data - The data object or array to sanitize.
		 * @param {Array} inclusion - The parsed inclusion array.
		 * @param {Array} exclusion - The parsed exclusion array.
		 * @returns {object | Array} The sanitized data object or array.
		 */
		function sanitizeData(data, inclusion, exclusion) {
			// If both inclusion and exclusion are null, return the data as is
			if (inclusion === null && exclusion === null) {
				return data;
			}

			if (Array.isArray(data)) {
				return data.map((item) =>
					sanitizeData(item, inclusion, exclusion)
				);
			} else if (typeof data === "object" && data !== null) {
				let sanitized = {};

				if (inclusion) {
					// Include only specified fields (supports nested fields)
					for (let i = 0; i < inclusion.length; i++) {
						let inclusionData = generateDotNotation(
							data,
							inclusion[i]
						);
						sanitized = { ...sanitized, ...inclusionData };
					}
					return dotNotationToObject(sanitized);
				} else if (exclusion) {
					for (let i = 0; i < exclusion.length; i++) {
						let exclusionData = generateDotNotation(
							data,
							exclusion[i],
							true
						);
						sanitized = { ...sanitized, ...exclusionData };
					}
					return dotNotationToObject(sanitized, data);
				}
			}

			return data;
		}

		/**
		 * Generates an object with dot notation keys from the given data and path.
		 *
		 * @param {Object} data - The source data object to extract values from.
		 * @param {string} path - A dot-separated string representing the path to access data.
		 *                        Supports array notation with `[]` (e.g., `users[].name`).
		 * @param {boolean} isEclusion - If true, the result will exclude the specified path by setting its value to `undefined`.
		 *                               If false, the result will include the value at the specified path.
		 *
		 * @returns {Object} - An object with dot notation keys representing the path in the data.
		 *                     Example: `{ "user.name": "John" }`
		 *
		 * @throws {Error} - Throws an error if the `path` parameter is not a string.
		 *
		 * The function supports:
		 * - Nested object traversal based on the `path`.
		 * - Array indexing when the path includes `[]` to handle elements dynamically.
		 *
		 * Key Details:
		 * - The `processKeys` function handles recursive traversal of the data structure.
		 * - If `isEclusion` is true, it marks the path with `undefined` to represent exclusion.
		 * - If the path points to an array (e.g., `users[].name`), it iterates through array elements,
		 *   appending index-based keys (e.g., `users[0].name`, `users[1].name`).
		 *
		 * Example Usage:
		 * ```
		 * const data = {
		 *   users: [
		 *     { name: "John", age: 30 },
		 *     { name: "Jane", age: 25 }
		 *   ]
		 * };
		 *
		 * const result = generateDotNotation(data, "users[].name", false);
		 * // Output: { "users[0].name": "John", "users[1].name": "Jane" }
		 * ```
		 */
		function generateDotNotation(data, path, isEclusion) {
			if (typeof path !== "string")
				throw new Error("Path must be a string");

			let result = {};

			function processKeys(dataItem, keys, prefix = "", result) {
				if (dataItem === undefined) return;

				if (!keys.length) {
					if (isEclusion) {
						result[prefix] = undefined;
					} else {
						result[prefix] = dataItem;
					}
					return;
				}

				let key = keys.shift();
				let isArray = key.endsWith("[]");
				if (isArray) key = key.slice(0, -2); // Remove [] from key

				// Construct prefix
				prefix = prefix ? `${prefix}.${key}` : key;

				const currentData = getValueFromObject(dataItem, key); // Using your existing function

				if (isArray && Array.isArray(currentData)) {
					currentData.forEach((item, index) => {
						const newPrefix = `${prefix}[${index}]`;
						processKeys(item, [...keys], newPrefix, result);
					});
				} else if (!isArray && currentData !== undefined) {
					processKeys(currentData, keys, prefix, result);
				}
			}

			if (data && path.trim()) {
				const keys = path.split(".");
				processKeys(data, keys, "", result);
			}

			return result;
		}

		async function checkFilter(authorized, data, apikey, unauthorize) {
			if (data.object.$filter && data.object.$filter.query) {
				let key;
				if (data.object.$filter.type == "object") key = "_id";
				else if (data.object.$filter.type == "array") key = "name";
				if (key) {
					for (let value of authorized[apikey]) {
						if (value[key]) value = value[key];
						if (!data.object.$filter.query.$or)
							data.object.$filter.query.$or = [];
						if (unauthorize)
							data.object.$filter.query.$or.push({
								[key]: { $ne: value }
							});
						else
							data.object.$filter.query.$or.push({
								[key]: value
							});
					}
					if (!unauthorize) return true;
				}
			}
		}

		function deleteKey(data, path) {
			if (!data || !path) return;
			if (path.includes("._id")) path = path.replace("._id", "");
			data = dotNotationToObject({ [path]: undefined }, data);
			return data;
		}

		return {
			check
		};
	}
);
