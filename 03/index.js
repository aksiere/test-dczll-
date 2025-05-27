import { createServer } from 'node:http'
import { createClient } from 'redis'

const PORT = 3000
const TIME_TO_LIVE = 60 * 60 * 24

// так конечно делать нельзя (экспозить чувствительную информацию), но чтобы можно было быстро проверить оставим так
const client = createClient({
    username: 'default',
    password: 'zS8SewrGvBuP12cGfRzzjmEJZkYfOXLe',
    socket: {
        host: 'redis-13571.crce175.eu-north-1-1.ec2.redns.redis-cloud.com',
        port: 13571
    }
})

client.on('error', err => console.log('Redis Client Error', err))
await client.connect()

const server = createServer(async (req, res) => {
	if (req.url === '/weather' && req.method === 'GET') {
		res.statusCode = 200
		res.setHeader('Content-Type', 'text/html')
		res.setHeader('Cache-Control', `public, max-age=${TIME_TO_LIVE}`)
		res.end(`
			<form method='GET' action='/weather' style='margin-bottom: 1rem;'>
				<input type='text' name='city' placeholder='enter city name' required style='padding: .5rem;'/>
				<button type='submit' style='padding: .5rem;'>search</button>
			</form>
		`)
		return
	}

	if (req.url.startsWith('/weather?') && req.method === 'GET') {
		const url = new URL(req.url, `http://${req.headers.host}`)
		const city = url.searchParams.get('city')
		const lat = url.searchParams.get('lat')
		const lon = url.searchParams.get('lon')

		if (!city && (!lat || !lon)) {
			res.statusCode = 400
			res.end('City OR (lat+lon) is required')
			return
		}

		try {
			if (lat && lon) {
				const key = lat + '_' + lon
				const data = await client.get(key)

				if (data) {
					// return Response.json({ data: JSON.parse(data), from: 'cache' }, { headers: { 'Cache-Control': `public, max-age=${TIME_TO_LIVE}` } })
					res.statusCode = 200
					res.setHeader('Content-Type', 'text/html')
					res.setHeader('Cache-Control', `public, max-age=${TIME_TO_LIVE}`)
					res.end(showChart(JSON.parse(data)))
					return
				}

				const r = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_hours=24`)).json()
				await client.set(key, JSON.stringify(r))
				await client.expire(key, TIME_TO_LIVE)

				// return Response.json({ data: r, from: 'api' })
				res.statusCode = 200
				res.setHeader('Content-Type', 'text/html')
				res.setHeader('Cache-Control', `public, max-age=${TIME_TO_LIVE}`)
				res.end(showChart(r))
				return
			}

			if (city) {
				const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${city}`)
				if (!response.ok) {
					throw new Error('Weather data not found')
				}
				const data = await response.json()
				res.statusCode = 200
				res.setHeader('Content-Type', 'text/html')
				res.setHeader('Cache-Control', `public, max-age=${TIME_TO_LIVE}`)
				res.end(`
					<div style='display: flex; flex-direction: column; gap: .5rem;'>
						${data.results?.map((r) => `
							<div style='display: flex; gap: .5rem;'>
								<a href='/weather?lat=${r.latitude}&lon=${r.longitude}'>Check</a>
								<span>${r.name}, ${r.country} (${r.admin1})</span>
							</div>
						`).join('') || 'No results found.'}
					</div>
				`)
				return
			}
			
		} catch (error) {
			res.statusCode = 500
			res.end(`Error fetching weather data: ${error.message}`)
			return
		}
	}

	res.statusCode = 404
	res.setHeader('Content-Type', 'text/plain')
	res.end('Not Found')
})

server.listen(PORT)

function showChart(data) {
	const temps = data.hourly.temperature_2m
	const times = data.hourly.time.map(t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }))

	return `
		<html>
		<head>
			<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
		</head>

		<style>
			body {
				margin: 0;
			}
		</style>

		<body>
			<div style="height: 100dvh; width: 100dvw;">
				<canvas id="myChart"></canvas>
			</div>

			<script>
				const canvas = document.getElementById('myChart')
				const ctx = canvas.getContext('2d')

				new Chart(ctx, {
					type: 'bar',
					data: {
						labels: ${JSON.stringify(times)},
						datasets: [{
							label: 'temperature (°C)',
							data: ${JSON.stringify(temps)},
						}]
					},
					options: {
						plugins: {
							legend: {
								display: false
							}	
						},
						scales: {
							y: {
								beginAtZero: true
							}
						},
						layout: {
							padding: 32
						},
					}
				})
			</script>
		</body>
		</html>
	`
}
