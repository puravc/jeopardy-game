#!/bin/bash
SERVER="http://localhost:3000"

echo "1. Create Game"
GAME_JSON=$(curl -s -X POST $SERVER/api/games -H "Content-Type: application/json" -d '{"name":"Test Game", "playerMode":"manual"}')
GAME_ID=$(echo $GAME_JSON | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Created Game ID: $GAME_ID"

echo "\n2. Add Players"
P1_JSON=$(curl -s -X POST $SERVER/api/games/$GAME_ID/players -H "Content-Type: application/json" -d '{"name":"Alice"}')
P1_ID=$(echo $P1_JSON | grep -o '"id":"[^"]*' | cut -d'"' -f4)
P2_JSON=$(curl -s -X POST $SERVER/api/games/$GAME_ID/players -H "Content-Type: application/json" -d '{"name":"Bob"}')
P2_ID=$(echo $P2_JSON | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Alice ID: $P1_ID, Bob ID: $P2_ID"

echo "\n3. Add Category & Question"
CAT_JSON=$(curl -s -X POST $SERVER/api/games/$GAME_ID/categories -H "Content-Type: application/json" -d '{"name":"Science"}')
CAT_ID=$(echo $CAT_JSON | grep -o '"id":"[^"]*' | cut -d'"' -f4)

# Manually add 1 question to the category
curl -s -X PUT $SERVER/api/games/$GAME_ID/categories/$CAT_ID/questions -H "Content-Type: application/json" -d '{"questions":[{"id":"q1","value":200,"question":"Test Q","answer":"Test A","answered":false,"answeredBy":null}]}' > /dev/null
echo "Category ID: $CAT_ID added with questions"

echo "\n4. Start Game"
curl -s -X POST $SERVER/api/games/$GAME_ID/start > /dev/null

echo "\n5. Award Points (Testing Stats)"
curl -s -X POST $SERVER/api/games/$GAME_ID/award -H "Content-Type: application/json" -d "{\"questionId\":\"q1\",\"playerId\":\"$P1_ID\",\"categoryId\":\"$CAT_ID\"}" > /dev/null

echo "\n6. Clone Game"
CLONE_JSON=$(curl -s -X POST $SERVER/api/games/$GAME_ID/clone -H "Content-Type: application/json" -d '{"name":"Cloned Test Game"}')
CLONE_ID=$(echo $CLONE_JSON | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Cloned Game ID: $CLONE_ID"

echo "\n7. Final Jeopardy Setup"
curl -s -X POST $SERVER/api/games/$GAME_ID/final-jeopardy -H "Content-Type: application/json" -d "{\"question\":\"Final Q\",\"answer\":\"Final A\",\"wagers\":{\"$P1_ID\":100, \"$P2_ID\":0}}" > /dev/null

echo "\n8. Final Jeopardy Resolve"
curl -s -X POST $SERVER/api/games/$GAME_ID/final-jeopardy/resolve -H "Content-Type: application/json" -d "{\"correct\":[\"$P1_ID\"], \"wrong\":[\"$P2_ID\"]}" > /dev/null

echo "\n9. Fetch Final Game State to verify Stats and Status"
curl -s $SERVER/api/games/$GAME_ID | grep -o '"stats":{.*}'
