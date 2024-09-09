const cors = require('cors')
const express = require('express')
const { PrismaClient } = require('@prisma/client')
const { body, param, validationResult } = require('express-validator')
const { v4: uuidv4 } = require('uuid')
const { Server } = require('socket.io')
const http = require('http')

const app = express()
const prisma = new PrismaClient()

app.use(express.json())
app.use(cors())
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
  },
})

// Function to generate short UUID
function generateUUID() {
  return uuidv4().replace(/-/g, '').substring(0, 8)
}

// Middleware for validation
const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  next()
}

// GET all containers with their items
app.get('/api/containers', async (req, res) => {
  try {
    const containers = await prisma.container.findMany({
      include: {
        items: {
          orderBy: {
            position: 'asc',
          },
        },
      },
      orderBy: {
        position: 'asc',
      },
    })
    res.json(containers)
  } catch (error) {
    res.status(500).json({ error: 'Error fetching containers' })
  }
})

// GET a specific container with its items
app.get(
  '/api/containers/:id',
  param('id').isString().isLength({ min: 5, max: 8 }),
  validate,
  async (req, res) => {
    const { id } = req.params
    try {
      const container = await prisma.container.findUnique({
        where: { id },
        include: {
          items: {
            orderBy: {
              position: 'asc',
            },
          },
        },
      })
      if (!container) {
        return res.status(404).json({ error: 'Container not found' })
      }
      res.json(container)
    } catch (error) {
      res.status(500).json({ error: 'Error fetching container' })
    }
  }
)

// POST new container
app.post(
  '/api/containers',
  body('title').isString().notEmpty(),
  body('description').optional().isString(),
  validate,
  async (req, res) => {
    const { title, description } = req.body
    try {
      const lastContainer = await prisma.container.findFirst({
        orderBy: {
          position: 'desc',
        },
      })
      const newPosition = lastContainer ? lastContainer.position + 1 : 0
      const newContainer = await prisma.container.create({
        data: {
          id: `container-${generateUUID()}`,
          title,
          description,
          position: newPosition,
        },
      })
      res.status(201).json(newContainer)
    } catch (error) {
      res.status(500).json({ error: 'Error creating container' })
    }
  }
)

// PATCH update container
app.patch(
  '/api/containers/:id',
  param('id').isString().isLength({ min: 5, max: 8 }),
  body('title').optional().isString(),
  body('description').optional().isString(),
  body('position').optional().isInt(),
  validate,
  async (req, res) => {
    const { id } = req.params
    const { title, description, position } = req.body
    try {
      const updatedContainer = await prisma.container.update({
        where: { id },
        data: {
          title,
          description,
          position,
        },
      })
      res.json(updatedContainer)
    } catch (error) {
      res.status(500).json({ error: 'Error updating container' })
    }
  }
)

// DELETE container
app.delete(
  '/api/containers/:id',
  param('id').isString().isLength({ min: 5, max: 8 }),
  validate,
  async (req, res) => {
    const { id } = req.params
    try {
      await prisma.container.delete({
        where: { id },
      })
      res.status(204).send()
    } catch (error) {
      res.status(500).json({ error: 'Error deleting container' })
    }
  }
)

// POST new item
app.post(
  '/api/containers/:containerId/items',
  param('containerId').isString(),
  body('title').isString().notEmpty(),
  validate,
  async (req, res) => {
    const { containerId } = req.params
    const { title } = req.body
    try {
      const lastItem = await prisma.item.findFirst({
        where: {
          containerId,
        },
        orderBy: {
          position: 'desc',
        },
      })
      const newPosition = lastItem ? lastItem.position + 1 : 0

      const newItem = await prisma.item.create({
        data: {
          id: `item-${generateUUID()}`,
          title,
          position: newPosition,
          containerId,
        },
      })
      res.status(201).json(newItem)
    } catch (error) {
      res.status(500).json({ error: 'Error creating item' })
    }
  }
)

// PATCH update item
app.patch(
  '/api/items/:id',
  param('id').isString().isLength({ min: 5, max: 8 }),
  body('title').optional().isString(),
  body('position').optional().isInt(),
  body('containerId').optional().isString().isLength({ min: 5, max: 8 }),
  validate,
  async (req, res) => {
    const { id } = req.params
    const { title, position, containerId } = req.body
    try {
      const updatedItem = await prisma.item.update({
        where: { id },
        data: {
          title,
          position,
          containerId,
        },
      })
      res.json(updatedItem)
    } catch (error) {
      res.status(500).json({ error: 'Error updating item' })
    }
  }
)

// DELETE item
app.delete(
  '/api/items/:id',
  param('id').isString().isLength({ min: 5, max: 8 }),
  validate,
  async (req, res) => {
    const { id } = req.params
    try {
      await prisma.item.delete({
        where: { id },
      })
      res.status(204).send()
    } catch (error) {
      res.status(500).json({ error: 'Error deleting item' })
    }
  }
)

// PATCH update items order within a container
app.patch('/api/containers-order-items', validate, async (req, res) => {
  const { containers } = req.body

  try {
    await prisma.$transaction(async (prisma) => {
      for (const container of containers) {
        const { id, items } = container
        for (const item of items) {
          await prisma.item.update({
            where: { id: item.id },
            data: { position: item.position, containerId: id },
          })
        }
      }
    })

    res.json({ message: 'Items order updated successfully' })
  } catch (error) {
    console.error('Error updating items order:', error)
    res.status(500).json({ error: 'Error updating items order' })
  }
})

// SOCKET
io.on('connection', async (socket) => {
  socket.on('requestInitialData', async () => {
    const containers = await prisma.container.findMany({
      include: {
        items: {
          orderBy: {
            position: 'asc',
          },
        },
      },
      orderBy: {
        position: 'asc',
      },
    })
    socket.emit('initialData', containers)
  })

  socket.on('updatedItems', async (containers) => {
    await prisma.$transaction(async (prisma) => {
      for (const container of containers) {
        const { id, items } = container
        for (const item of items) {
          await prisma.item.update({
            where: { id: item.id },
            data: { position: item.position, containerId: id },
          })
        }
      }
    })
    const newData = await prisma.container.findMany({
      include: {
        items: {
          orderBy: {
            position: 'asc',
          },
        },
      },
      orderBy: {
        position: 'asc',
      },
    })
    io.emit('dataUpdated', newData)
  })

  socket.on('disconnect', () => {
    console.log('User disconnected')
  })
})
io.listen(3001)

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
