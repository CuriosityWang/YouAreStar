/** Admin-only tooling (publish official templates) is dev-only and tree-shaken
 *  out of production builds via this flag. */
export const IS_ADMIN = import.meta.env.DEV;
