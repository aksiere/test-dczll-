import { createServer } from 'node:http'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import path from 'node:path'

const PORT = 3000
const JWT_SECRET = 'alpine'
const TIME_TO_LIVE = 60 * 60 * 24

// DB

import { DatabaseSync } from 'node:sqlite'
import { createReadStream, mkdir, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdirSync, existsSync } from 'node:fs'
import { unlinkSync } from 'node:fs'
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
			const files = await getUserFiles(payload.email)

			res.statusCode = 200
			res.setHeader('Content-Type', 'text/html')
			res.end(`
				<p>${payload.email}</p>
				
				<div>
					<form method='POST' action='/upload' enctype='multipart/form-data'>
						<input type='file' name='file' required>
						<input type='number' name='time_to_delete' placeholder='delete in N minutes' value='720' required>
						<button type='submit'>upload</button>
					</form>
				</div>

				<div>
					<p>Files:</p>
					<div style='display: flex; flex-direction: column; gap: 1rem;'>
						${files?.reverse().map(file => {
							const uploadedAt = new Date(file.uploaded_at)
							const expiresAt = new Date(file.uploaded_at)
							expiresAt.setMinutes(expiresAt.getMinutes() + file.time_to_delete)

							return `
								<div style='display: flex; flex-direction: column; gap: 0.25rem;'>
									<div style='display: flex; gap: 0.5rem; align-items: center;'>
										<a href="/files/${file.id}">${file.name}${file.ext ? '.' + file.ext : ''}</a>
										<button type="button" onclick="navigator.clipboard.writeText(location.origin + '/files/${file.id}')">copy link</button>
									</div>
									<span style='font-family: monospace; font-size: 14px; color: #555;'>${file.id}</span>
									<span>${uploadedAt.toLocaleString('ru-RU')} -- ${expiresAt.toLocaleString('ru-RU')} (${file.time_to_delete} min.)</span>
									<span>(${file.downloaded_n_times} downloads)</span>
								</div>
							`
						}).join('') || '<span style=\'color: #555;\'>No files uploaded</span>'}
					</div>
				</div>
			`)
			return
		} catch (err) {
			console.log(err)

			res.statusCode = 302
			res.setHeader('Location', '/in')
			res.end('Unauthorized')
			return
		}
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
			res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Path=/; Max-Age=${TIME_TO_LIVE}`)
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
			res.setHeader('Set-Cookie', `token=${token}; HttpOnly; Path=/; Max-Age=${TIME_TO_LIVE}`)
			res.setHeader('Location', '/')
			res.end('OK')
		})

		return
	}

	if (req.url === '/upload' && req.method === 'POST') {
		const token = await getToken(req)
		if (!token) {
			res.statusCode = 401
			res.end('Unauthorized')
			return
		}

		let payload
		try {
			payload = jwt.verify(token, JWT_SECRET)
		} catch (err) {
			res.statusCode = 401
			res.end('Invalid token')
			return
		}

		if (!existsSync('./uploads')) {
			mkdirSync('./uploads')
		}

		let chunks = []
		const boundary = req.headers['content-type'].split('boundary=')[1]

		req.on('data', chunk => {
			chunks.push(chunk)
		})

		req.on('end', async () => {
			// const { email, password } = Object.fromEntries(params.entries())

			const buffer = Buffer.concat(chunks)
			const marker = Buffer.from(`--${boundary}`)
			const boundaryNewLine = Buffer.from('\r\n')

			let position = 0
			let fileBuffer = null
			let fileName = ''
			let timeToDelete = 720 // Default to 720 minutes

			while (position < buffer.length) {
				const boundaryPosition = buffer.indexOf(marker, position)
				if (boundaryPosition < 0) break

				const dataStart = buffer.indexOf(boundaryNewLine, boundaryPosition) + boundaryNewLine.length
				const headers = buffer.slice(dataStart, buffer.indexOf(boundaryNewLine.toString() + boundaryNewLine.toString(), dataStart)).toString()

				if (headers.includes('filename')) {
					const fileNameMatch = headers.match(/filename="([^"]+)"/)
					if (fileNameMatch) {
						fileName = fileNameMatch[1]
					}

					const fileStart = buffer.indexOf(boundaryNewLine + boundaryNewLine, dataStart) + (boundaryNewLine.length * 2)
					const fileEnd = buffer.indexOf(marker, fileStart) - 2 // -2 to remove \r\n

					fileBuffer = buffer.slice(fileStart, fileEnd)
				} else if (headers.includes('time_to_delete')) {
					const contentStart = buffer.indexOf(boundaryNewLine + boundaryNewLine, dataStart) + (boundaryNewLine.length * 2)
					const contentEnd = buffer.indexOf(marker, contentStart) - 2
					const timeValue = buffer.slice(contentStart, contentEnd).toString()
					timeToDelete = parseInt(timeValue) || 720
					console.log(timeToDelete)
					
				}

				position = boundaryPosition + marker.length
			}

			if (!fileName || !fileBuffer) {
				res.statusCode = 400
				res.end('No file uploaded')
				return
			}

			const fileId = randomUUID()
			const fileExt = path.extname(fileName).slice(1)
			const fileNameWithoutExt = path.basename(fileName, '.' + fileExt)

			if (!existsSync('./uploads')) {
				mkdirSync('./uploads')
			}

			writeFileSync(`./uploads/${fileId}.${fileExt}`, fileBuffer)
			await saveFile(fileId, fileNameWithoutExt, fileExt, timeToDelete, payload.email)

			res.statusCode = 302
			res.setHeader('Location', '/')
			res.end('File uploaded successfully')
		})

		return
	}

	if (req.url.startsWith('/files/') && req.method === 'GET') {
		const fileId = req.url.split('/files/')[1]
		const file = await getFile(fileId)

		if (!file) {
			res.statusCode = 404
			res.setHeader('Content-Type', 'text/plain')
			res.end('File not found')
			return
		}

		const filePath = `./uploads/${file.id}.${file.ext}`
		if (!existsSync(filePath)) {
			res.statusCode = 404
			res.setHeader('Content-Type', 'text/plain')
			res.end('File not found')
			return
		}

		file.downloaded_n_times += 1
		await updateDownloadCount(file.id, file.downloaded_n_times)

		res.statusCode = 200
		res.setHeader('Content-Type', 'application/octet-stream')
		res.setHeader('Content-Disposition', `attachment; filename="${file.name}${file.ext ? '.' + file.ext : ''}"`)

		const stream = createReadStream(filePath)
		stream.pipe(res)
		return
	}

	res.statusCode = 404
	res.setHeader('Content-Type', 'text/plain')
	res.end('Not Found')
})

server.listen(PORT)

// удаление файлов через X минут после загрузки (простейшая реализация (лучше каким-нибудь кроном))
setInterval(() => {
	const expired = db.prepare(`
		SELECT id, time_to_delete, ext FROM files
		WHERE strftime('%s', 'now') - strftime('%s', uploaded_at) >= time_to_delete * 60
	`).all()

	console.log(expired)

	for (const { id, ext } of expired) {
		const path = `uploads/${id}${ext ? '.' + ext : ''}`
		try {
			unlinkSync(path)
		} catch (err) {
			console.error(`Failed to delete file ${path}:`, err)
		}
		db.prepare('DELETE FROM files WHERE id = ?').run(id)
	}
}, 60 * 1000)

// 

async function getUserFiles(email) {
	return new Promise((resolve) => {
		const files = db.prepare('SELECT * FROM files WHERE user_id = ?').all(email)

		if (files) {
			resolve(files)
		} else {
			resolve([])
		}
	})
}

async function getToken(req) {
	return new Promise((resolve) => {
		const token = req.headers.cookie?.split('; ').find(row => row.startsWith('token='))?.split('=')[1]
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

async function saveFile(fileId, fileNameWithoutExt, fileExt, timeToDelete, email) {
	return new Promise((resolve) => {
		const data = db.prepare(`
			INSERT INTO files (id, name, ext, time_to_delete, user_id) 
			VALUES (?, ?, ?, ?, ?)
		`).run(fileId, fileNameWithoutExt, fileExt, timeToDelete, email)

		if (data) {
			resolve(data)
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

async function getFile(fileId) {
	return new Promise((resolve) => {
		const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId)
		if (file) {
			resolve(file)
		} else {
			resolve(null)
		}
	})
}

async function updateDownloadCount(fileId, count) {
	return new Promise((resolve) => {
		const data = db.prepare('UPDATE files SET downloaded_n_times = ? WHERE id = ?').run(count, fileId)
		if (data) {
			resolve(data)
		} else {
			resolve(null)
		}
	})
}
