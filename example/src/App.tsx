import { StyleSheet, Text, View } from 'react-native';
import { multiply } from 'rn-sak';
import { createRestApi, Delete, Get, Post, Put } from 'rn-sak/rest';

const result = multiply(3, 7);

type User = {
    id: string;
    name: string;
    email: string;
};

type CreateUserDto = {
    name: string;
    email: string;
};

type UpdateUserDto = {
    name?: string;
    email?: string;
};

class UserApiClass {
    @Get('/users')
    listUsers!: (vars?: { query?: { page?: number } }) => User[];

    @Get('/users/:id')
    getUser!: (vars: { params: { id: string } }) => User;

    @Post('/users')
    createUser!: (vars: { body: CreateUserDto }) => User;

    @Put('/users/:id')
    updateUser!: (vars: { params: { id: string }; body: UpdateUserDto }) => User;

    @Delete('/users/:id')
    deleteUser!: (vars: { params: { id: string } }) => void;
}

export default function App() {
    const api = createRestApi(UserApiClass, { baseURL: 'https://api.example.com' });
    const { isLoading, data, error } = api.useGetUser({ params: { id: '42' } });

    console.log(isLoading, data, error);

    return (
        <View style={styles.container}>
            <Text>Result: {result}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
