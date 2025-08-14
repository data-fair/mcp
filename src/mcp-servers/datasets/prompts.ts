import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

/*
  * ==================================================================
  * ----------------------------  Prompts ----------------------------
  * ==================================================================
  */
const registerPrompts = (server: McpServer) => {
  server.registerPrompt(
    'search_company_headquarters',
    {
      title: 'Cherche le siège social d\'une entreprise',
      description: 'Cette invite permet de trouver le siège social d\'une entreprise à partir de son nom',
      argsSchema: {
        companyName: z.string().describe('Le nom de l\'entreprise pour laquelle vous souhaitez trouver le siège social')
      }
    },
    ({ companyName }) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: 'Cherche le siège social de l\'entreprise ' + companyName + '\nPour cela :\n1. Cherche spécifiquement les jeux de données relatifs aux sièges sociaux d\'entreprises\n2. Cherche les informations de l\'entreprise ' + companyName + ' dans le jeu de données le plus pertinent.\n3. Retourne le siège social sous forme de texte, en indiquant aussi le nom du jeu de données et l\'URL du jeu de données utilisé pour trouver l\'information.\n\nSi tu ne trouves pas d\'information, retourne "Aucune information trouvée".',
            }
          }
        ]
      }
    }
  )

  server.registerPrompt(
    'search_address_gendarmerie',
    {
      title: 'Cherche l\'adresse d\'une gendarmerie',
      description: 'Cette invite permet de trouver l\'adresse d\'une gendarmerie à partir de son nom',
      argsSchema: {
        gendarmerieName: z.string().describe('Le nom de la gendarmerie / la brigade pour laquelle vous souhaitez trouver l\'adresse')
      }
    },
    ({ gendarmerieName }) => {
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: 'Cherche l\'adresse de la gendarmerie ' + gendarmerieName + '\nPour cela :\n1. Cherche spécifiquement les jeux de données relatifs aux adresses de gendarmeries\n2. Cherche les informations de la gendarmerie ' + gendarmerieName + ' dans le jeu de données le plus pertinent.\n3. Retourne l\'adresse sous forme de texte, en indiquant aussi le nom du jeu de données et l\'URL du jeu de données utilisé pour trouver l\'information.\n\nSi tu ne trouves pas d\'information, retourne "Aucune information trouvée".',
            }
          }
        ]
      }
    }
  )
}

export default registerPrompts
