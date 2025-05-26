import { createServer } from 'node:http'

const PORT = 3000

const server = createServer((req, res) => {
	if (req.url === '/' && req.method === 'GET') {
		res.statusCode = 200
		res.setHeader('Content-Type', 'text/plain')
		res.end('OK')
		return
	}

	res.statusCode = 404
	res.setHeader('Content-Type', 'text/plain')
	res.end('Not Found')
})

server.listen(PORT)
