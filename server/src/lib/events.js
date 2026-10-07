// Real-time updates (Server-Sent Events). The server never sends data over this channel — only a tiny
// "something changed" signal. The page then re-requests its own data through the normal, access-checked API,
// so a client can never receive anything they could not already read.
const connections = new Set(); // { res, userId, role }

export function addConnection(conn) {
  connections.add(conn);
  return () => connections.delete(conn);
}

/**
 * Tell connected pages that data changed.
 * @param {{ admin?: boolean, users?: string[] | 'all' }} to  admin pages, specific users, or every signed-in page
 */
export function publish({ admin = true, users = 'all' } = {}) {
  // A beat later, so the database transaction that caused this has finished before pages re-read.
  setTimeout(() => {
    for (const c of connections) {
      const isAdmin = c.role === 'ADMIN' || c.role === 'PAYMENTS'; // staff pages
      if ((admin && isAdmin) || users === 'all' || (Array.isArray(users) && users.includes(c.userId))) {
        try {
          c.res.write('event: update\ndata: {}\n\n');
        } catch {
          connections.delete(c);
        }
      }
    }
  }, 120);
}

export const connectionCount = () => connections.size;
