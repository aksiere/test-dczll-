import { createServer } from 'node:http'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const PORT = 3000
const JWT_SECRET = 'alpine'

// DB

import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync('test.db')

db.exec(`
    CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        name TEXT,
        ext TEXT,
        time_to_delete INTEGER DEFAULT 720,
		downloaded_n_times INTEGER DEFAULT 0,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		user_id TEXT
    )
`)

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        password TEXT NOT NULL
    )
`)

// Create test user if not exists
const testEmail = 'shiropatin@gmail.com'
const testPassword = 'alpine'
const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(testEmail)
if (!existing) {
	const hash = bcrypt.hashSync(testPassword, 10)
	db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(testEmail, hash)
}

// 

const server = createServer(async (req, res) => {
	if (req.url === '/' && req.method === 'GET') {
		const token = await getToken(req)

		if (!token) {
			res.statusCode = 302
			res.setHeader('Location', '/in')
			res.end('Unauthorized')
			return
		}

		let payload
		try {
			payload = jwt.verify(token, JWT_SECRET)
		} catch (err) {
			res.statusCode = 302
			res.setHeader('Location', '/in')
			res.end('Unauthorized')
			return
		}

		res.statusCode = 200
		res.setHeader('Content-Type', 'text/plain')
		res.end('Authorized as ' + payload.email)
		return
	}

	if (req.url === '/in' && req.method === 'GET') {
		res.statusCode = 200
		res.setHeader('Content-Type', 'text/html')
		res.end(`
			<form method='POST' action='/in'>
				<input type='email' name='email' placeholder='Email' required>
				<input type='password' name='password' placeholder='Password' required>
				<button type='submit'>Sign In</button>
				<a href='/up'>No account?</a>
			</form>
		`)
		return
	}

	if (req.url === '/in' && req.method === 'POST') {
		let body = ''
		
		req.on('data', chunk => {
			body += chunk
		})

		req.on('end', async () => {
			const params = new URLSearchParams(body)
			const { email, password } = Object.fromEntries(params.entries())

			const user = await getUser(email, password)
			if (!user || !bcrypt.compareSync(password, user.password)) {
				res.statusCode = 401
				res.setHeader('Content-Type', 'text/plain')
				res.end('Invalid credentials')
				return
			}

			const token = await createToken({ email })
			
			res.statusCode = 302
			res.setHeader('Content-Type', 'text/plain')
			res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Path=/; Max-Age=3600`)
			res.setHeader('Location', '/')
			res.end('OK')
		})

		return
	}

	if (req.url === '/up' && req.method === 'GET') {
		res.statusCode = 200
		res.setHeader('Content-Type', 'text/html')
		res.end(`
			<form method='POST' action='/up'>
				<input type='email' name='email' placeholder='Email' required>
				<input type='password' name='password' placeholder='Password' required>
				<button type='submit'>Sign Up</button>
				<a href='/in'>Already have an account?</a>
			</form>
		`)
		return
	}

	if (req.url === '/up' && req.method === 'POST') {
		let body = ''
		
		req.on('data', chunk => {
			body += chunk
		})

		req.on('end', async () => {
			const params = new URLSearchParams(body)
			const { email, password } = Object.fromEntries(params.entries())

			if (!email || !password) {
				res.statusCode = 400
				res.setHeader('Content-Type', 'text/plain')
				res.end('Email and password are required')
				return
			}

			const user = await getUser(email)
			if (user) {
				res.statusCode = 400
				res.setHeader('Content-Type', 'text/plain')
				res.end('User already exists')
				return
			}

			const hash = bcrypt.hashSync(password, 10)
			db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(email, hash)
			const token = await createToken({ email })
			
			res.statusCode = 200
			res.setHeader('Content-Type', 'text/plain')
			res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Path=/; Max-Age=60`)
			res.end('OK')
		})

		return
	}

	if (req.url === '/test' && req.method === 'GET') {
		const data = await someAsyncFunction()

		res.statusCode = 200
		res.setHeader('Content-Type', 'text/plain')
		res.end(data.message)
		return
	}

	res.statusCode = 404
	res.setHeader('Content-Type', 'text/plain')
	res.end('Not Found')
})

server.listen(PORT)

// 

async function someAsyncFunction(email, password) {
	return new Promise((resolve) => {
		setTimeout(() => resolve({ message: 'Data fetched successfully' }), 1000)
	})
}

async function getToken(req) {
	return new Promise((resolve) => {
		const token = req.headers.cookie
			?.split('; ')
			.find(row => row.startsWith('token='))
			?.split('=')[1]

		if (token) {
			resolve(token)
		} else {
			resolve(null)
		}
	})
}

async function getUser(email) {
	return new Promise((resolve) => {
		const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
		if (user) {
			resolve(user)
		} else {
			resolve(null)
		}
	})
}

async function createToken(data) {
	return new Promise((resolve) => {
		const token = jwt.sign(data, JWT_SECRET, { expiresIn: '1h' })
		resolve(token)
	})
}
